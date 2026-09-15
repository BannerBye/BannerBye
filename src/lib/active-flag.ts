/**
 * BannerBye — active-flag bridge (v0.2.0)
 *
 * Het probleem dat dit oplost: TCF/CMP/GPC content scripts draaien in
 * MAIN world, waar `chrome.storage` niet beschikbaar is. Tot v0.1.x hadden
 * we daardoor géén manier om die scripts daadwerkelijk uit te schakelen
 * bij toggle-off of per-site pause. De DNR-rule werd wel uitgezet, maar
 * de JS-injecties (__tcfapi, navigator.globalPrivacyControl, euconsent-v2
 * cookie) bleven gewoon draaien. Pijnlijk debugbaar gedrag, gebroken
 * product-promise.
 *
 * Oplossing: window-flag bridge. Background script injecteert vóór onze
 * MAIN-world scripts een tiny inline-script via chrome.scripting.executeScript
 * met injectImmediately:true. Dat script zet `window.__bannerbyeState` op
 * de huidige state. Onze MAIN content scripts checken die flag aan het
 * begin van main() en doen early-return als state !== 'active'.
 *
 * Voordelen:
 *  - Cross-browser werkt (Chrome MV3 + Firefox MV2 + Safari MV2 met fallback)
 *  - Geen runtime-unregister van manifest-scripts nodig (wat MV2 niet kan)
 *  - Geen architectuur-overhaul — alleen een early-return per script
 *  - Settings-changes propageren via background listener + re-injectie
 *
 * Limitaties:
 *  - Bestaande `euconsent-v2` cookies blijven plakken na toggle-off
 *    (vereist chrome.cookies permission — pas in v0.3.0 toegevoegd)
 *  - `navigator.globalPrivacyControl` met `configurable:false` kan niet
 *    ongedaan gemaakt worden op dezelfde pagina-load — pas na reload
 *
 * Zie /04. Output/BannerBye/v0.1.5-architecture.md voor het volledige plan.
 */

import { isHostPaused, normalizeHost } from './host.ts';
import { getSettings } from './storage.ts';

/**
 * State die de bridge naar MAIN-world scripts communiceert.
 *  - 'active'   → alle interventies aan
 *  - 'disabled' → globale toggle uit, geen enkele interventie
 *  - 'paused'   → globaal aan, maar deze host gepauzeerd door user
 */
export type ActiveState = 'active' | 'disabled' | 'paused';

/**
 * Property-naam op window die de inline-script zet. Bewust een lange,
 * onderscheidende naam om collisions met page-scripts te voorkomen.
 *
 * MAIN content scripts lezen deze global property direct uit. Geen
 * andere extensies of page-scripts mogen hem zetten (zou een security-
 * issue zijn, maar omdat we 'm via executeScript injecteren zit hij
 * vóór page-scripts in document_start).
 */
export const ACTIVE_FLAG_KEY = '__bannerbyeState';

/**
 * Type-augmentatie zodat TypeScript de flag op window kent.
 */
declare global {
  interface Window {
    [ACTIVE_FLAG_KEY]?: ActiveState;
  }
}

/**
 * Bereken de active-state voor een hostname op basis van current settings.
 *
 * - Settings.enabled === false → 'disabled' (toggle uit, niets doen)
 * - Hostname in pausedSites    → 'paused'   (alleen GPC-header doorlaten)
 * - Anders                     → 'active'
 *
 * Wordt aangeroepen door background bij elke navigation event.
 */
export async function computeStateForHost(hostname: string | null): Promise<ActiveState> {
  const settings = await getSettings();
  if (!settings.enabled) return 'disabled';
  if (!hostname) return 'active';
  return isHostPaused(hostname, settings.pausedSites) ? 'paused' : 'active';
}

/**
 * Inline-functie die door background.ts via chrome.scripting.executeScript
 * (of browser.tabs.executeScript op MV2) in de MAIN-world wordt geïnjecteerd.
 *
 * BELANGRIJK: deze functie wordt geserialized en in de page context uitgevoerd.
 * Heeft GEEN toegang tot import-symbolen uit dit bestand. Alleen wat als
 * argument meegegeven wordt (`state`) en globals van de page (window).
 *
 * Houd 'm dus zo simpel mogelijk en zelfstandig.
 *
 * v0.4.5 (fix #13, security-audit 2026-09-16) — bescherming naar het
 * patroon van `__tcfapi` in tcf.content.ts: installeer een `configurable:
 * false`-accessor-property i.p.v. een kale schrijfbare dataproperty.
 *
 * Wat dit WEL oplost: vóór deze fix was `window[flagKey] = state` een
 * gewone, overschrijfbare toewijzing. Een pagina die vóór onze injectie (of
 * gelijktijdig, bv. via een eigen `Object.defineProperty` met
 * `writable:false, configurable:false`) de property claimt, kon 'm
 * permanent op een waarde vastzetten — waarna GEEN latere, legitieme
 * her-injectie (bv. wanneer Robin de toggle omzet tijdens dezelfde
 * paginasessie) 'm nog kon bijwerken. Door zelf als eerste (background
 * injecteert met `injectImmediately:true` op `document_start`, vóór
 * page-scripts) een `configurable:false`-accessor te installeren, kan een
 * pagina die niet meer overschrijven/vervangen — onze eigen setter blijft
 * altijd werken voor toekomstige her-injecties op dezelfde pagina.
 *
 * Wat dit NIET oplost: MAIN-world content scripts draaien in dezelfde
 * JS-realm als de pagina zelf (dat is precies waarom ze daar draaien — zie
 * de toelichting bovenaan dit bestand). Er bestaat geen "van-ons-maar-niet-
 * van-de-pagina"-scheiding binnen die realm, dus een pagina kan via onze
 * setter nog steeds een GELDIGE state-waarde (zoals 'disabled') zetten om
 * zichzelf te ontwijken. Dat is een architectuurgrens, geen implementatie-
 * bug — zie ook de vergelijkbare toelichting bij bridge.content.ts's
 * CustomEvent-relay (fix #7).
 */
export function inlineSetFlag(state: ActiveState, flagKey: string): void {
  // Aanname: deze runt in page-context (MAIN world). `window` is hier
  // het page-window, niet de extension-context.
  const w = window as unknown as Record<string, unknown>;
  try {
    let current: ActiveState = state;
    Object.defineProperty(w, flagKey, {
      get: () => current,
      set: (value: unknown) => {
        // Alleen echte ActiveState-waarden accepteren — negeer rommel
        // i.p.v. 'm klakkeloos door te geven aan content scripts die een
        // van de drie exacte strings verwachten.
        if (value === 'active' || value === 'disabled' || value === 'paused') {
          current = value;
        }
      },
      enumerable: true,
      configurable: false,
    });
  } catch {
    // defineProperty faalt hier typisch omdat de accessor al bestaat van
    // een eerdere injectie op DEZELFDE pagina (live toggle-update, geen
    // reload) — configurable:false blokkeert dan bewust een herinstallatie.
    // Val terug op een gewone toewijzing: die roept onze eigen, al
    // geïnstalleerde setter aan.
    try {
      w[flagKey] = state;
    } catch {
      // Frozen window o.i.d. — niet kritiek. Content scripts behandelen een
      // afwezige/onleesbare flag als 'active' (fail-open, zie readActiveState()).
    }
  }
}

/**
 * Helper voor content scripts: lees de flag uit window.
 *
 * Returns 'active' als de flag niet gezet is — pure backward-compat:
 * als het bridge-mechanisme zou falen, blijft BannerBye in elk geval
 * werken zoals voorheen (geen silent-disable).
 */
export function readActiveState(): ActiveState {
  try {
    const state = window[ACTIVE_FLAG_KEY];
    if (state === 'disabled' || state === 'paused' || state === 'active') {
      return state;
    }
  } catch {
    // window-toegang faalt — onmogelijk maar safety net.
  }
  return 'active';
}
