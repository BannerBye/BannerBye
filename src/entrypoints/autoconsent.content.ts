/**
 * BannerBye — Autoconsent-laag content script (Fase 1).
 *
 * ⚠️ STANDAARD UIT. Zet `AUTOCONSENT_LAYER_ENABLED` op true nadat je 'm in een
 * dev-build in een echte browser hebt getest op een paar CMP-sites. Deze laag
 * draait op elke pagina en coördineert met de generieke auto-click; verifieer
 * dus vóór productie.
 *
 * ISOLATED world, document_start: Autoconsent doet z'n eigen prehide en heeft
 * z'n detectie zo vroeg mogelijk nodig.
 */

import { defineContentScript } from 'wxt/sandbox';
import { getSettings } from '@/lib/storage.ts';
import { isHostPaused } from '@/lib/host.ts';

/** Feature-flag — pas op true na dev-browser-verificatie. */
const AUTOCONSENT_LAYER_ENABLED = false;

export default defineContentScript({
  matches: ['<all_urls>'],
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
  runAt: 'document_start',
  allFrames: false,

  async main() {
    if (!AUTOCONSENT_LAYER_ENABLED) return;

    try {
      const settings = await getSettings();
      if (!settings.enabled) return;
      if (isHostPaused(location.hostname, settings.pausedSites)) return;
    } catch {
      // storage-race bij startup — fail-open zoals de andere lagen.
    }

    // Dynamische import: de (grote) Autoconsent-regelbundel wordt pas geladen
    // wanneer de laag daadwerkelijk aanstaat — geen kosten zolang de flag uit is.
    const { startAutoconsentLayer } = await import(
      '@/lib/autoclick/autoconsent-layer.ts'
    );

    startAutoconsentLayer(() => {
      // Bekende CMP geweigerd → tel mee als een geblokkeerde banner (background
      // is single source of truth voor de teller/badge/milestones).
      try {
        void chrome.runtime.sendMessage({ type: 'bb:banner-blocked' });
      } catch {
        // background kan net idle zijn — niet kritiek.
      }
    });
  },
});
