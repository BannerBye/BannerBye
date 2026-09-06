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
import { isPdfDocument } from '@/lib/pdf-guard.ts';
import { shouldProcessFrame } from '@/lib/frame-guard.ts';
// v0.4.2 (#204): flag verhuisd naar een gedeelde module — prehide.ts moet
// 'm ook kunnen lezen (zie feature-flags.ts voor de volledige toelichting
// en het heise.de-incident dat dit nodig maakte).
import { AUTOCONSENT_LAYER_ENABLED } from '@/lib/feature-flags.ts';

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
  // v0.3.7 (#170): 26 van de gebundelde Autoconsent-regels hebben
  // `runContext.frame === true` en `main === false` — die konden met
  // allFrames:false nooit vuren. Sourcepoint (bild.de) is precies zo'n geval.
  allFrames: true,

  async main() {
    // v0.3.7: in sub-frames alleen doorgaan als dit een consent-frame kan zijn.
    // Zonder deze rem zou de 672 KB-regelbundel in élk advertentie-iframe
    // geladen worden — op een nieuwssite tientallen keren per pagina.
    if (!shouldProcessFrame()) return;

    // v0.3.1: PDF's op extensieloze URL's glippen door excludeMatches — runtime-check.
    if (isPdfDocument()) return;

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
        void chrome.runtime.sendMessage({
          type: 'bb:banner-blocked',
          platform: 'Known platform',
        });
      } catch {
        // background kan net idle zijn — niet kritiek.
      }
    });
  },
});
