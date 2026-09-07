/**
 * BannerBye — Autoconsent-laag content script (Fase 1).
 *
 * Sinds 2026-09-07 AAN in de code (`AUTOCONSENT_LAYER_ENABLED` in
 * feature-flags.ts — daar staat ook waarom, en welke hosts uitgesloten zijn).
 * Deze laag draait op elke pagina en coördineert met de generieke auto-click;
 * verifieer elke wijziging in een echte browser vóór een release.
 *
 * ISOLATED world, document_start: Autoconsent doet z'n eigen prehide en heeft
 * z'n detectie zo vroeg mogelijk nodig.
 */

import { defineContentScript } from 'wxt/sandbox';
import { getSettings } from '@/lib/storage.ts';
import { isHostPaused } from '@/lib/host.ts';
import { isPdfDocument } from '@/lib/pdf-guard.ts';
import { shouldProcessFrameDeferred, isSourcepointFrameUrl } from '@/lib/frame-guard.ts';
// v0.4.2 (#204): flag verhuisd naar een gedeelde module — prehide.ts moet
// 'm ook kunnen lezen (zie feature-flags.ts voor de volledige toelichting
// en het heise.de-incident dat dit nodig maakte).
import { AUTOCONSENT_LAYER_ENABLED, isAutoconsentExcludedHost } from '@/lib/feature-flags.ts';

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
    if (!AUTOCONSENT_LAYER_ENABLED) return;

    // v0.4.2 (#212): zware productiviteits-apps zonder cookie-banner op het
    // app-oppervlak (Google Sheets bleef met deze laag aan minutenlang
    // onbereikbaar) — zie feature-flags.ts voor de onderbouwing.
    if (isAutoconsentExcludedHost(location.hostname)) return;

    // v0.3.7: in sub-frames alleen doorgaan als dit een consent-frame kan zijn.
    // Zonder deze rem zou de 672 KB-regelbundel in élk advertentie-iframe
    // geladen worden — op een nieuwssite tientallen keren per pagina.
    // v0.4.2 (#170): de uitgestelde variant — de tekst-heuristiek kreeg op
    // document_start nooit een body te zien en zei daardoor altijd "nee".
    if (!(await shouldProcessFrameDeferred())) return;

    // v0.3.1: PDF's op extensieloze URL's glippen door excludeMatches — runtime-check.
    if (isPdfDocument()) return;

    try {
      const settings = await getSettings();
      if (!settings.enabled) return;
      if (isHostPaused(location.hostname, settings.pausedSites)) return;
    } catch {
      // storage-race bij startup — fail-open zoals de andere lagen.
    }

    // v0.4.2 (#170): in een Sourcepoint-frame beheert de motor het
    // instellingenpaneel zelf (openen, weigeren, en zo nodig terugdraaien op
    // consent-of-betaal-sites). Zet de rem op laag 5's "doorklikken" hier al
    // — dit script draait op document_start, ruim vóór de generieke
    // auto-click op document_idle; de motor zelf komt via de background pas
    // later binnen en zou die race op bild.de verliezen.
    if (isSourcepointFrameUrl()) {
      (window as Window & { __bbStepIntoBlocked?: boolean }).__bbStepIntoBlocked = true;
    }

    // v0.4.2 (#212, 7 sep): de motor zelf (autoconsent-engine.content.ts,
    // ~800 KB inclusief de regelbundel) wordt hier NIET meer ge-import. Een
    // `import()` in een content script wordt door de bundler inline gezet,
    // waardoor de hele bundel — inclusief de 672 KB regel-literal — op
    // document_start in élk frame werd geëvalueerd, óók in de tientallen
    // advertentie-iframes die de frame-guard daarna meteen weer afwees.
    // Nu vragen we de background om de motor alleen in dít frame te
    // injecteren (chrome.scripting.executeScript met frameId). Dit script
    // blijft daardoor een paar KB: de poortwachter, niets meer.
    try {
      Promise.resolve(chrome.runtime.sendMessage({ type: 'bb:autoconsent-inject' })).catch(
        () => {},
      );
    } catch {
      // background kan net idle zijn — dan geen motor op deze pagina; de
      // overige lagen (TCF, CMP-handlers, generieke auto-click) draaien gewoon.
    }
  },
});
