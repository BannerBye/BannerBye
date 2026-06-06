/**
 * BannerBye — auto-click fallback content script.
 *
 * Laatste verdedigingslaag — voor sites die geen TCF gebruiken en
 * geen herkenbare third-party CMP draaien (custom Nederlandse e-commerce
 * banners zoals wehkamp, zalando, en talloze andere). Dit script zoekt
 * een "Weigeren"-achtige knop in de DOM en klikt 'm namens de gebruiker.
 *
 * Architectuur:
 *  - ISOLATED world (default) — we hoeven niet bij window.__tcfapi
 *    te komen, alleen bij de DOM. ISOLATED is veiliger.
 *  - runAt: document_idle — we hebben geen race-conditie met page-scripts;
 *    we wachten gewoon tot de banner gerendered is, dan klikken we.
 *  - Alleen main frame — banners zitten zelden in iframes, en als ze
 *    er wel zitten zijn die meestal cross-origin (wij kunnen er niet bij).
 *
 * Trade-off: deze laag is reactief. Banner verschijnt 100-500ms voor
 * we 'm wegklikken. Niet "before they load" zoals onze TCF-laag, maar
 * "before you saw" — voor de gebruiker hetzelfde resultaat. Het schendt
 * bewust onze "BannerBye refuses"-puurheid alleen op sites waar we
 * geen alternatief hebben (zie decisions-log 2026-04-21 over fallback
 * strategy: prevention → auto-click → visible).
 *
 * Per-site pause: voor v0.1 niet geïmplementeerd op deze laag. Background
 * unregistert deze content script wanneer extensie globaal uit staat.
 */

import { defineContentScript } from 'wxt/sandbox';
import { startAutoClick } from '@/lib/autoclick/index.ts';
import { setRemoteKeywords } from '@/lib/autoclick/keywords.ts';
import { getCachedRules } from '@/lib/rules/fetcher.ts';
import { getSettings } from '@/lib/storage.ts';
import { isHostPaused } from '@/lib/host.ts';

export default defineContentScript({
  matches: ['<all_urls>'],
  // v0.1.2: skip PDF-viewer routes — zie tcf.content.ts voor toelichting.
  // v0.1.4: enterprise SaaS hosts — zie tcf.content.ts.
  excludeMatches: [
    '*://*/*.pdf',
    '*://*/*.PDF',
    '*://*/*PdfViewer*',
    '*://*/*pdfviewer*',
    '*://*/*PDFViewer*',
    '*://*/*pdf-viewer*',
    '*://*/*PdfViewer.aspx*',
    '*://*/*Viewer.aspx*',
    '*://*/*viewer.aspx*',
    '*://*.exactonline.nl/*',
    '*://*.exactonline.be/*',
    '*://*.exactonline.com/*',
    '*://*.exactonline.co.uk/*',
    '*://*.exactonline.de/*',
    '*://*.exactonline.fr/*',
    '*://*.exactonline.es/*',
  ],
  // document_idle = nadat de pagina volledig geladen is + alle event-handlers
  // zijn aangelopen. Dit is laat genoeg dat custom banners typisch al
  // gerendered zijn, vroeg genoeg dat de gebruiker er nog niet veel
  // van gezien heeft.
  runAt: 'document_idle',
  allFrames: false,

  async main() {
    // v0.2.0: respect globale toggle en per-site pause. autoclick draait
    // in ISOLATED world dus heeft directe chrome.storage-toegang — geen
    // window-flag-bridge nodig hier (anders dan TCF/CMP/GPC).
    try {
      const settings = await getSettings();
      if (!settings.enabled) return;
      if (isHostPaused(location.hostname, settings.pausedSites)) return;
    } catch {
      // storage-error — fail-open (= v0.1.x-gedrag). Beter dan een silent
      // disable wanneer er een race-conditie is bij browser-startup.
    }

    // Laad remote rules (gefetched + gecached door background) zodat onze
    // keyword-lijsten extra varianten meenemen die nieuw zijn sinds release.
    // Faalt stil — bundled keywords werken sowieso.
    try {
      const remote = await getCachedRules();
      if (remote?.autoclick) {
        setRemoteKeywords(remote.autoclick);
      }
    } catch {
      // storage.local niet beschikbaar of corrupt — niet kritiek.
    }

    const result = await startAutoClick();
    if (result.clicked) {
      // v0.2.0: stuur banner-blocked event naar background. Background
      // doet de counter-increment, badge-flash, en milestone-check als
      // single source of truth voor storage-writes. Voorkomt race tussen
      // popup en background-detectie van nieuwe milestones (#86).
      try {
        void chrome.runtime.sendMessage({ type: 'bb:banner-blocked' });
      } catch {
        // Background-worker kan net idle zijn — niet kritiek.
      }
      // Voor debug: console.log(`[BannerBye] auto-click: "${result.buttonText}" in ${result.elapsedMs}ms`);
    }
  },
});
