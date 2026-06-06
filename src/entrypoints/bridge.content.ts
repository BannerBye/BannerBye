/**
 * BannerBye — DOM-event bridge (v0.2.0, #114)
 *
 * TCF/CMP content scripts draaien in MAIN world en hebben daarom geen
 * directe toegang tot chrome.runtime.sendMessage. Wanneer ze succesvol
 * een banner blokkeren, dispatchen ze een CustomEvent op `window`. Dit
 * script luistert in ISOLATED world op die events en relayt ze naar
 * background als 'bb:banner-blocked' message — exact hetzelfde format
 * als autoclick.content.ts gebruikt.
 *
 * Resultaat: TCF- en CMP-blocks tellen óók mee voor de popup-teller +
 * triggeren badge-flash + milestone-check. Sites zonder zichtbaar banner
 * (TCF werkt preventief) krijgen nu ook telleropbouw.
 *
 * Per-pageload dedup gebeurt in de sender (tcf/cmp script's blockedReported
 * flag). Dus dit script kan elk event 1-op-1 doorgeven.
 *
 * v0.2.0 (#114): nieuw — zie ook tcf.content.ts en cmp.content.ts.
 *
 * Geen MV3-vs-MV2 verschil — dit is een normale manifest-registered
 * content script, geen runtime registration.
 */

import { defineContentScript } from 'wxt/sandbox';

export default defineContentScript({
  matches: ['<all_urls>'],
  // Zelfde excludes als TCF/CMP (PDF-viewers + enterprise SaaS).
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
  // document_start zodat we klaar zijn voordat TCF/CMP scripts evt.
  // hun events kunnen dispatchen (MAIN scripts runnen iets later).
  runAt: 'document_start',
  // ISOLATED is default — daar hebben we chrome.runtime nodig.
  allFrames: false,

  main() {
    const relay = (): void => {
      try {
        void chrome.runtime.sendMessage({ type: 'bb:banner-blocked' });
      } catch {
        // Background-worker idle of ander runtime-probleem — niet kritiek.
      }
    };

    // Belangrijk: listen op `document`, niet `window`. Events op window
    // flowen NIET cross-world in Chrome MV3 (MAIN-world TCF/CMP scripts
    // dispatchen op document zodat onze ISOLATED bridge ze ook hoort).
    document.addEventListener('bb:tcf-blocked', relay);
    document.addEventListener('bb:cmp-blocked', relay);
  },
});
