/**
 * BannerBye — Autoconsent-laag content script (Fase 1, referentie-wiring).
 *
 * ⚠️ STANDAARD UIT. Zet `AUTOCONSENT_LAYER_ENABLED` op true na een dev-browser-
 * test (console mag geen autoconsent-fouten geven). Deze laag draait op elke
 * pagina (incl. iframes) en werkt samen met de background (init/eval) en de
 * generieke auto-click (window-vlaggen).
 */

import { defineContentScript } from 'wxt/sandbox';
import { getSettings } from '@/lib/storage.ts';
import { isHostPaused } from '@/lib/host.ts';

/** Feature-flag — geverifieerd in dev-browser (CNN + nu.nl schoon, geen crash, 2026-07-09). */
const AUTOCONSENT_LAYER_ENABLED = true;

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
  // Alle frames: CMP's als Sourcepoint renderen in een iframe.
  allFrames: true,

  async main() {
    if (!AUTOCONSENT_LAYER_ENABLED) return;

    // Enabled/paused alleen in het hoofdframe checken (subframes erven de keuze).
    if (window.top === window.self) {
      try {
        const settings = await getSettings();
        if (!settings.enabled) return;
        if (isHostPaused(location.hostname, settings.pausedSites)) return;
      } catch {
        // storage-race bij startup — fail-open zoals de andere lagen.
      }
    }

    // Dynamische import: laadt de AutoConsent-engine pas als de flag aanstaat.
    const { startAutoconsentContent } = await import(
      '@/lib/autoclick/autoconsent-layer.ts'
    );

    startAutoconsentContent(() => {
      try {
        void chrome.runtime.sendMessage({ type: 'bb:banner-blocked' });
      } catch {
        // background kan net idle zijn — niet kritiek.
      }
    });
  },
});
