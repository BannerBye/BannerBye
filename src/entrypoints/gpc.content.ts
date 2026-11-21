/**
 * BannerBye — GPC content script
 *
 * Injecteert `navigator.globalPrivacyControl = true` op elke pagina,
 * vóór andere scripts draaien. Sites checken vaak in JS naar deze
 * property om hun consent-flow te skippen.
 *
 * De HTTP-header `Sec-GPC: 1` wordt apart gestuurd door
 * background.ts via declarativeNetRequest — die werkt op netwerk-
 * niveau, terwijl deze content script op JS-niveau werkt.
 *
 * Belangrijk:
 *  - `world: 'MAIN'` zorgt dat de injectie in de page-context loopt,
 *    niet in de geïsoleerde extension-context. Anders ziet de site
 *    `navigator.globalPrivacyControl` niet.
 *  - `runAt: 'document_start'` zorgt dat we vóór page-scripts zijn.
 *
 * GEEN settings-check hier: in MAIN world is `chrome.storage` niet
 * beschikbaar. De globale on/off wordt afgedwongen op DNR-niveau
 * (background.ts), wat de Sec-GPC header in/uit zet — het signaal
 * dat servers daadwerkelijk lezen. De JS-property staat altijd aan
 * zolang de extensie actief is; per-site pause raakt later de
 * TCF/CMP-injectie (intrusieve laag), niet GPC.
 */

import { defineContentScript } from 'wxt/sandbox';
import { traceMain } from '@/lib/trace.ts';
import { readActiveState } from '@/lib/active-flag.ts';
import { isPdfDocument } from '@/lib/pdf-guard.ts';

export default defineContentScript({
  // v0.2.0 (#111): Chrome MV3 → dynamic. Zie tcf.content.ts voor toelichting.
  matches:
    (import.meta as unknown as { env: { BROWSER: string } }).env.BROWSER === 'chrome'
      ? ['https://_bb_runtime_only_.invalid/*']
      : ['<all_urls>'],
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
  runAt: 'document_start',
  world: 'MAIN',
  allFrames: true,

  main() {
    // v0.3.1: PDF's op extensieloze URL's glippen door excludeMatches — runtime-check.
    if (isPdfDocument()) return;

    // v0.2.0: bij toggle-OFF of paused-host doen we de prototype-mutatie
    // niet. De HTTP-header (DNR) wordt elders gestuurd:
    //   - Bij toggle-OFF (globaal): syncGpcRuleset(false) zet de DNR-rule uit
    //   - Bij paused-host: header blijft globaal aan (= signaalwaarde)
    // De JS-property is dus altijd in sync met de "active"-state.
    if (readActiveState() !== 'active') {
      return;
    }

    // v0.4.19: stuurt de browser zelf al GPC? Safari (iOS/macOS 27.3), Edge
    // (VS), Firefox, Brave en straks Chrome hebben een eigen schakelaar. Een
    // native getter herkennen we aan "[native code]"; een getter van een
    // andere extensie niet. Alleen het hoofdframe meldt (de bridge luistert
    // alleen daar).
    try {
      const desc = Object.getOwnPropertyDescriptor(Navigator.prototype, 'globalPrivacyControl');
      const isNative =
        !!desc?.get && /\[native code\]/.test(Function.prototype.toString.call(desc.get));
      if (isNative && (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true) {
        traceMain('gpc', 'browser sends GPC natively');
        if (window.top === window) {
          // Twee keer: nu, en bij DOMContentLoaded — de bridge (ISOLATED,
          // ook document_start) kan net na ons starten. Hij dedupt zelf.
          const ping = () => document.dispatchEvent(new CustomEvent('bb:native-gpc'));
          ping();
          document.addEventListener('DOMContentLoaded', ping, { once: true });
        }
      }
    } catch {
      // detectie is bijzaak
    }

    try {
      Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', {
        get: () => true,
        configurable: false,
      });
      traceMain('gpc', 'Sec-GPC header rule active · navigator.globalPrivacyControl=true');
    } catch {
      // Sommige sites/extensies kunnen al een definitie hebben gezet.
      // Niet stoppen — header-laag (DNR) doet z'n werk nog steeds.
      traceMain('gpc', 'Sec-GPC header rule active · globalPrivacyControl already defined by page/other extension');
    }
  },
});
