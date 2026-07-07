/**
 * BannerBye — background service worker
 *
 * Verantwoordelijkheden:
 *  - Initialiseren bij install (defaults zetten, onboarding-tab openen)
 *  - GPC-header-rules dynamisch beheren afhankelijk van enabled-state
 *  - Active-flag bridge via dynamic content script registration
 *
 * v0.2.0 — active-flag bridge:
 *  Dynamische registratie van MAIN-world content scripts (via
 *  chrome.scripting.registerContentScripts) die `window.__bannerbyeState`
 *  zetten op 'active' / 'disabled' / 'paused'. Onze TCF/CMP/GPC content
 *  scripts checken die flag aan het begin van main() en doen early-return
 *  als state !== 'active'.
 *
 *  Waarom registerContentScripts en niet executeScript? Bij executeScript
 *  via tabs.onUpdated of webNavigation.onBeforeNavigate is er een race:
 *  Chrome wacht niet op de async listener voor de navigation doorgaat,
 *  dus MAIN-world document_start scripts kunnen al gerund hebben voordat
 *  onze flag-set arriveert. Dynamic content scripts daarentegen worden
 *  door Chrome zelf geïnstalleerd in dezelfde injection-pipeline als
 *  manifest-scripts — gegarandeerd op de juiste timing.
 *
 *  Bij elke settings-change unregistert het background de oude flag-
 *  scripts en registreert nieuwe op basis van enabled + pausedSites.
 *
 * GPC-header (DNR) zit los van de bridge. Globaal uit → ruleset
 * uitgeschakeld. Per-site pause raakt alleen JS-injecties, niet de
 * header — een gepauseerde site krijgt nog wel het Sec-GPC signaal.
 */

import { defineBackground } from 'wxt/sandbox';
import {
  getSettings,
  getStats,
  markInstalled,
  incrementBlocked,
  markUnlockedAndPending,
  markReportFixed,
} from '@/lib/storage';
import { normalizeHost } from '@/lib/host';
import type { SyncedSettings } from '@/lib/types';
import { computeNewUnlocks, MILESTONES } from '@/lib/milestones';
import {
  fetchRemoteRules,
  scheduleRulesFetch,
  isRulesFetchAlarm,
} from '@/lib/rules/fetcher';

const GPC_RULESET_ID = 'gpc-headers';

/**
 * IDs van alle dynamisch geregistreerde content scripts.
 *
 * Flag-setters (zetten window.__bannerbyeState in MAIN world):
 *  - 'bb-flag-active'   alles BEHALVE paused + SaaS
 *  - 'bb-flag-paused'   alleen paused-hosts
 *  - 'bb-flag-disabled' alles, alleen bij globaal uit
 *
 * Effectief-werkende content scripts (alleen geregistreerd bij globaal aan):
 *  - 'bb-tcf'  TCF-spoof — runt na bb-flag-active, vóór page-scripts
 *  - 'bb-cmp'  CMP-handlers
 *  - 'bb-gpc'  navigator.globalPrivacyControl-injectie
 *
 * Waarom dynamisch? Manifest-static content scripts runnen volgens Chrome
 * MV3-spec vóór dynamic content scripts in dezelfde world + run_at. Dat
 * is precies de race waar TCF/CMP/GPC z'n flag-check 'undefined' kreeg.
 * Door TCF/CMP/GPC ook dynamic te registreren NA de flag-setters, garandeer
 * we de volgorde: flag eerst, dan spoof. Per-site pause werkt nu écht.
 */
const BB_DYNAMIC_IDS = [
  'bb-flag-active',
  // 'bb-flag-paused' was hier voor v0.2.0 #113. Veroorzaakte witte pagina op
  // zalando.nl bij 4× refresh in paused-state. Verwijderd — onze excludeMatches
  // op TCF/CMP/GPC handelen paused-hosts al af. Behoud ID in unregister-lijst
  // voor cleanup van oude installs die het script nog geregistreerd hebben.
  'bb-flag-paused',
  'bb-flag-disabled',
  'bb-gpc',
  'bb-tcf',
  'bb-cmp',
] as const;

/**
 * Excludes voor de dynamisch geregistreerde content scripts. Gespiegeld
 * uit de excludeMatches die TCF/CMP/GPC scripts hadden bij MV2 manifest-
 * registratie, plus v0.1.4 SaaS-hosts.
 *
 * Zonder deze excludes zouden onze dynamic scripts op PDF-viewers en
 * Exact Online runnen — wat we juist via v0.1.2 en v0.1.4 vermeden hebben.
 */
const PDF_VIEWER_EXCLUDES: string[] = [
  '*://*/*.pdf',
  '*://*/*.PDF',
  '*://*/*PdfViewer*',
  '*://*/*pdfviewer*',
  '*://*/*PDFViewer*',
  '*://*/*pdf-viewer*',
  '*://*/*PdfViewer.aspx*',
  '*://*/*Viewer.aspx*',
  '*://*/*viewer.aspx*',
];

const ENTERPRISE_SAAS_EXCLUDES: string[] = [
  '*://*.exactonline.nl/*',
  '*://*.exactonline.be/*',
  '*://*.exactonline.com/*',
  '*://*.exactonline.co.uk/*',
  '*://*.exactonline.de/*',
  '*://*.exactonline.fr/*',
  '*://*.exactonline.es/*',
];

const BASE_EXCLUDES: string[] = [
  ...PDF_VIEWER_EXCLUDES,
  ...ENTERPRISE_SAAS_EXCLUDES,
];

/**
 * Bouw match-patterns voor een hostname (genormaliseerd, zonder www.).
 * We dekken zowel de apex (`nu.nl`) als alle subdomeinen (`*.nu.nl`) af —
 * de meeste sites serveren content vanaf beide.
 */
function hostMatchPatterns(host: string): string[] {
  return [`*://${host}/*`, `*://*.${host}/*`];
}

/**
 * Registreer de juiste flag-setter content scripts op basis van settings.
 *
 * Workflow:
 *   1. Verwijder alle bestaande bannerbye-flag-* scripts (idempotent).
 *   2. Bepaal config aan de hand van enabled + pausedSites.
 *   3. Registreer nieuwe scripts via chrome.scripting.registerContentScripts.
 *
 * Cross-browser:
 *  - Chrome MV3 + Firefox MV3: chrome.scripting beschikbaar — werkt.
 *  - Firefox MV2 / Safari MV2: chrome.scripting is undefined — fallback:
 *    behoud v0.1.x gedrag (flag wordt niet gezet, content scripts treaten
 *    als 'active'). Niet ideaal maar geen regressie.
 */
async function syncFlagSetterScripts(settings: SyncedSettings): Promise<void> {
  if (typeof chrome.scripting?.registerContentScripts !== 'function') {
    // MV2 fallback — niets te doen. v0.1.x gedrag blijft.
    return;
  }

  // STEP 1: unregister bestaande BB-scripts (alle 6 IDs, idempotent).
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts({
      ids: BB_DYNAMIC_IDS as unknown as string[],
    });
    if (existing.length > 0) {
      await chrome.scripting.unregisterContentScripts({
        ids: existing.map((s) => s.id),
      });
    }
  } catch {
    // Geen bestaande scripts of API faalt — verder gaan.
  }

  // STEP 2: bouw de nieuwe scripts.
  // Type-cast op 'MAIN' want @types/chrome heeft ExecutionWorld als literal
  // type maar TypeScript inferred string vanuit object-literal.
  const MAIN: chrome.scripting.ExecutionWorld = 'MAIN';

  const pausedPatterns = settings.pausedSites.flatMap(hostMatchPatterns);

  const scripts: chrome.scripting.RegisteredContentScript[] = [];

  if (!settings.enabled) {
    // Globaal uit → één flag-script. Geen TCF/CMP/GPC registreren.
    // De DNR-rule wordt elders uitgeschakeld (syncGpcRuleset).
    scripts.push({
      id: 'bb-flag-disabled',
      matches: ['<all_urls>'],
      excludeMatches: BASE_EXCLUDES,
      js: ['state/flag-disabled.js'],
      runAt: 'document_start',
      world: MAIN,
      allFrames: true,
      persistAcrossSessions: false,
    });
  } else {
    // Globaal aan. Volgorde van registratie bepaalt injection-volgorde:
    // flag-setters EERST (zodat window.__bannerbyeState gezet is),
    // dan TCF/CMP/GPC (die de flag lezen voordat ze hun spoof installeren).
    const activeExcludes = [...pausedPatterns, ...BASE_EXCLUDES];

    scripts.push({
      id: 'bb-flag-active',
      matches: ['<all_urls>'],
      excludeMatches: activeExcludes,
      js: ['state/flag-active.js'],
      runAt: 'document_start',
      world: MAIN,
      allFrames: true,
      persistAcrossSessions: false,
    });

    // v0.2.0 (#113): bb-flag-paused is opzettelijk NIET meer geregistreerd.
    // Op paused-hosts veroorzaakte deze script een witte pagina bij sommige
    // sites (zalando.nl, 4× refresh). Architecturaal is hij ook redundant:
    // TCF/CMP/GPC scripts zijn al uitgesloten op paused-hosts via de
    // excludeMatches van bb-flag-active. Hun defense-in-depth check
    // readActiveState() krijgt op paused-hosts 'active' (default fallback),
    // maar ze runnen er niet eens — geen risico.

    // TCF/CMP/GPC dynamisch — alleen waar flag-active runt. Op paused hosts
    // én PDF-viewers + SaaS-excludes blijven ze uit. Onze defense-in-depth
    // (early-return check in elke script op readActiveState) blijft staan
    // als safety net voor edge cases (cross-frame state mismatch e.d.).
    scripts.push({
      id: 'bb-gpc',
      matches: ['<all_urls>'],
      excludeMatches: activeExcludes,
      js: ['content-scripts/gpc.js'],
      runAt: 'document_start',
      world: MAIN,
      allFrames: true,
      persistAcrossSessions: false,
    });
    scripts.push({
      id: 'bb-tcf',
      matches: ['<all_urls>'],
      excludeMatches: activeExcludes,
      js: ['content-scripts/tcf.js'],
      runAt: 'document_start',
      world: MAIN,
      allFrames: true,
      persistAcrossSessions: false,
    });
    scripts.push({
      id: 'bb-cmp',
      matches: ['<all_urls>'],
      excludeMatches: activeExcludes,
      js: ['content-scripts/cmp.js'],
      runAt: 'document_start',
      world: MAIN,
      // CMP-handler doet detect() per-document; iframes worden door TCF
      // afgehandeld. Zelfde gedrag als v0.1.x defineContentScript.
      allFrames: false,
      persistAcrossSessions: false,
    });
  }

  // STEP 3: register per-script. We blijven bij per-script registratie
  // (i.p.v. bulk) zodat een fout op één script de andere niet meeneemt —
  // bv. een corrupte exclude-pattern op één script niet de hele bridge
  // breekt. Alleen errors loggen.
  for (const script of scripts) {
    try {
      await chrome.scripting.registerContentScripts([script]);
    } catch (err) {
      console.error('[BannerBye] register failed for', script.id, ':', err);
    }
  }
}

/**
 * Korte oranje "✓" badge op het toolbar-icoon, ~900ms zichtbaar. UI-
 * feedback bij elke succesvol gekilde banner via autoclick. Per-tab
 * zodat een actie in tab A geen badge op tab B veroorzaakt.
 *
 * Voor TCF/CMP-spoof is geen badge nodig — die werken preventief, de
 * gebruiker ziet überhaupt geen banner. Alleen voor autoclick is een
 * "ja, we hebben net iets weggeklikt"-confirmatie behulpzaam.
 */
async function flashTabBadge(tabId: number): Promise<void> {
  try {
    await chrome.action.setBadgeBackgroundColor({ color: '#E85A2C', tabId });
    await chrome.action.setBadgeText({ text: '✓', tabId });
    setTimeout(() => {
      // Tab kan ondertussen gesloten zijn → catch zonder logging.
      void chrome.action.setBadgeText({ text: '', tabId }).catch(() => {});
    }, 900);
  } catch {
    // setBadge* faalt soms op chrome:// of net-gesloten tabs — niet kritiek.
  }
}

/**
 * Persistente "🎉" badge (geen tabId → default voor alle tabs). Blijft
 * staan tot de popup geopend wordt en de celebration card gedismissed is.
 * Set bij elke nieuwe milestone-unlock, cleared via clearCelebrationBadge.
 *
 * v0.2.0: nieuw voor milestones-feature (#86).
 */
async function setCelebrationBadge(): Promise<void> {
  try {
    await chrome.action.setBadgeBackgroundColor({ color: '#E85A2C' });
    await chrome.action.setBadgeText({ text: '🎉' });
  } catch {
    // Niet kritiek.
  }
}

/**
 * Sync de persistent default badge naar aantal unlocked milestones (#85).
 * Toont een persistent rang-indicator in de toolbar — bv. "3" als drie van
 * de 7 milestones unlocked zijn. Leeg bij 0.
 *
 * Per-tab badge (✓-flash via flashTabBadge, of pending 🎉 celebration)
 * overruled deze default visueel tijdens hun lifespan. Na hun clear valt
 * de toolbar terug op deze base — een persistente "score" voor de user.
 */
async function syncRankBadge(): Promise<void> {
  try {
    const stats = await getStats();
    // Filter tegen MILESTONES zodat corrupte storage-IDs niet meetellen.
    const unlockedCount = MILESTONES.filter((m) =>
      stats.unlockedMilestones.includes(m.id),
    ).length;

    if (
      stats.pendingCelebrations.length > 0 ||
      stats.pendingReportFixed.length > 0
    ) {
      // Celebration heeft prioriteit. setCelebrationBadge zorgt voor 🎉.
      // Niet hier overschrijven (geldt ook voor "melding gekild"-cards).
      return;
    }

    await chrome.action.setBadgeBackgroundColor({ color: '#E85A2C' });
    await chrome.action.setBadgeText({
      text: unlockedCount > 0 ? String(unlockedCount) : '',
    });
  } catch {
    // Niet kritiek.
  }
}

/**
 * Verwerk een banner-blocked event: increment counter, flash per-tab badge,
 * en check of een milestone nét-nu unlockt → set persistent celebration badge.
 *
 * Background is de single source of truth voor storage-writes — content
 * scripts sturen alleen de message. Voorkomt race tussen popup-display en
 * achtergrond-detectie.
 */
async function handleBannerBlocked(
  tabId: number,
  hostname: string | null,
): Promise<void> {
  try {
    const stats = await incrementBlocked();
    await flashTabBadge(tabId);

    const newlyUnlocked = computeNewUnlocks(stats);
    if (newlyUnlocked.length > 0) {
      await markUnlockedAndPending(newlyUnlocked.map((m) => m.id));
      await setCelebrationBadge();
    }

    // #reward-1: als dit een host is die de gebruiker ooit als kapot meldde,
    // is de melding nu "opgelost" — zet 'm klaar voor een celebration card.
    // Puur lokaal; markReportFixed is een no-op als de host niet gemeld was.
    if (hostname) {
      const { changed } = await markReportFixed(hostname);
      if (changed) await setCelebrationBadge();
    }
  } catch (err) {
    console.warn('[BannerBye] handleBannerBlocked failed:', err);
  }
}

/**
 * Update of de GPC declarativeNetRequest rule-set actief is.
 * Roep dit aan na elke settings-change die `enabled` raakt.
 */
async function syncGpcRuleset(enabled: boolean): Promise<void> {
  try {
    if (enabled) {
      await chrome.declarativeNetRequest.updateEnabledRulesets({
        enableRulesetIds: [GPC_RULESET_ID],
      });
    } else {
      await chrome.declarativeNetRequest.updateEnabledRulesets({
        disableRulesetIds: [GPC_RULESET_ID],
      });
    }
  } catch (err) {
    // Firefox kan kuren hebben met DNR — log maar crash niet.
    console.warn('[BannerBye] Could not toggle DNR ruleset:', err);
  }
}

export default defineBackground({
  // `persistent: false` is verplicht voor Safari op iOS/iPadOS — die ondersteunt
  // geen langlopende background pages. Onze code is event-driven (chrome.alarms,
  // chrome.runtime.onInstalled, chrome.storage.onChanged) dus event-page-stijl
  // is functioneel equivalent. Geen impact op Chrome MV3 (daar wordt 't sowieso
  // genegeerd — service worker is altijd non-persistent).
  persistent: false,
  type: 'module',

  main() {
  // === BOOT-TIME SYNC ===
  // onInstalled vuurt niet bij elke service-worker boot (alleen bij eerste
  // install, update of browser-update). Bij elke wake of bij refresh van
  // een unpacked dev-extensie runt main() wel. Dus we synchroniseren de
  // flag-setter scripts hier direct, idempotent. registerContentScripts
  // overschrijft bestaande scripts veilig (we unregisteren eerst).
  void (async () => {
    try {
      const settings = await getSettings();
      await syncGpcRuleset(settings.enabled);
      await syncFlagSetterScripts(settings);
      await syncRankBadge();
    } catch (err) {
      console.warn('[BannerBye] boot sync failed:', err);
    }
  })();

  // === REMOTE RULES (alarm-based) ===
  // Periodieke fetch van keyword-updates van bannerbye.com.
  scheduleRulesFetch();
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (isRulesFetchAlarm(alarm)) {
      void fetchRemoteRules();
    }
  });

  // === BANNER-BLOCKED MESSAGES VAN CONTENT SCRIPTS ===
  // autoclick.content.ts stuurt {type: 'bb:banner-blocked'} na een
  // succesvolle click. Background increments counter, flasht tab-badge,
  // en checkt op nieuwe milestone-unlocks (zie #86).
  chrome.runtime.onMessage.addListener((msg, sender) => {
    if (msg?.type === 'bb:banner-blocked' && sender.tab?.id !== undefined) {
      // Hostname uit de tab-URL (voor #reward-1 melding-gekild-detectie).
      const host = sender.tab.url ? normalizeHost(sender.tab.url) : null;
      void handleBannerBlocked(sender.tab.id, host);
    }
    return false; // Geen async response.
  });

  // === INSTALL / UPDATE ===
  // GpcRuleset + flag-setter sync gebeuren al in de boot-sync hierboven
  // (die altijd runt bij service-worker startup, ook bij install/update).
  // Hier alleen de install-specifieke dingen: install-marker + onboarding-tab.
  chrome.runtime.onInstalled.addListener(async (details) => {
    await markInstalled();
    const settings = await getSettings();

    // Direct fetch bij install — anders moet de gebruiker een dag wachten
    // op de eerste alarm-fire voor remote rules beschikbaar zijn.
    void fetchRemoteRules();

    if (details.reason === 'install' && !settings.onboardingCompleted) {
      // Welkomst-tab eenmalig openen bij eerste install.
      // De onboarding zelf marked onboardingCompleted=true wanneer de
      // gebruiker de flow afmaakt of skipt — dan komt deze tab niet
      // terug bij volgende installs/updates.
      try {
        await chrome.tabs.create({
          url: chrome.runtime.getURL('onboarding.html'),
        });
      } catch (err) {
        console.warn('[BannerBye] Could not open onboarding tab:', err);
      }
    }
  });

  // === STARTUP ===
  // Browser-start triggert ook main() opnieuw, en daar zit al een
  // boot-sync. Deze listener is daardoor leeg, behouden voor toekomstige
  // startup-specifieke logica.

  // === SETTINGS-CHANGES VOLGEN ===
  // Bij elke pop-up actie (toggle of pause):
  //   1. Sync de GPC-header DNR-ruleset met de nieuwe enabled-waarde.
  //   2. Re-registreer de flag-setter content scripts zodat een volgende
  //      pagina-load de nieuwe state oppikt.
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area === 'sync') {
      const newSettings = changes.settings?.newValue as SyncedSettings | undefined;
      if (!newSettings) return;
      if (typeof newSettings.enabled === 'boolean') {
        await syncGpcRuleset(newSettings.enabled);
      }
      await syncFlagSetterScripts(newSettings);
    } else if (area === 'local') {
      // Stats kunnen veranderd zijn → re-sync rang-badge (#85).
      if (changes.stats) {
        await syncRankBadge();
      }
    }
  });
  },
});
