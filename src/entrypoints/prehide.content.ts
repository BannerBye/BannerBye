/**
 * BannerBye — prehide content script (document_start).
 *
 * Verbergt bekende cookie-banner-containers al vóór ze schilderen, zodat de
 * autoclick-laag ze flikkervrij kan weigeren. Coördineert met
 * autoclick.content.ts via een CustomEvent (beide draaien in dezelfde
 * ISOLATED world in het hoofdframe en delen dus `window`).
 *
 * Reveal-logica (ethos: nooit stil verbergen wat we niet kunnen weigeren):
 *  - autoclick meldt "geklikt"  → banner wordt door de CMP verwijderd; prehide
 *    even later opheffen (geen flikker, banner is al weg).
 *  - autoclick meldt "niet geklikt" → meteen tonen zodat de gebruiker zelf kan
 *    kiezen.
 *  - harde safety-timeout → altijd tonen na REVEAL_FALLBACK_MS, wat er ook
 *    gebeurt.
 *  - extensie uit / site gepauzeerd → meteen tonen.
 */

import { defineContentScript } from 'wxt/sandbox';
import { injectPrehide, revealPrehide } from '@/lib/autoclick/prehide.ts';
import { getSettings } from '@/lib/storage.ts';
import { isHostPaused } from '@/lib/host.ts';

/** Maximale tijd dat een banner onzichtbaar mag blijven zonder uitsluitsel. */
const REVEAL_FALLBACK_MS = 3500;

export default defineContentScript({
  matches: ['<all_urls>'],
  // Zelfde excludes als de andere lagen (PDF-viewers + enterprise SaaS).
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

  main() {
    // Zo vroeg mogelijk verbergen — vóór de banner schildert.
    injectPrehide();

    let revealed = false;
    const reveal = (): void => {
      if (revealed) return;
      revealed = true;
      revealPrehide();
    };

    // Extensie uit of site gepauzeerd? Meteen tonen (fail-open bij storage-fout).
    void (async () => {
      try {
        const settings = await getSettings();
        if (!settings.enabled || isHostPaused(location.hostname, settings.pausedSites)) {
          reveal();
        }
      } catch {
        // Storage-race bij startup — laat de safety-timeout het afhandelen.
      }
    })();

    // Uitslag van de autoclick-laag (zelfde ISOLATED world → gedeelde window).
    window.addEventListener(
      'bb:autoclick-done',
      (e: Event) => {
        const handled = Boolean((e as CustomEvent).detail?.handled);
        if (handled) {
          // Weiger geverifieerd; banner wordt door de CMP verwijderd. Prehide
          // kort daarna opheffen zodat een later, ongerelateerd element niet
          // verborgen blijft.
          window.setTimeout(reveal, 800);
        } else {
          // Niet (betrouwbaar) geweigerd → banner tonen zodat de gebruiker kiest.
          reveal();
        }
      },
      { once: true },
    );

    // Harde vangnet: nooit langer onzichtbaar dan dit.
    window.setTimeout(reveal, REVEAL_FALLBACK_MS);
  },
});
