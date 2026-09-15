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
import { isPdfDocument } from '@/lib/pdf-guard.ts';

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
    // v0.3.1: PDF's op extensieloze URL's glippen door excludeMatches — runtime-check.
    if (isPdfDocument()) return;

    // v0.4.0: het platform-label uit de CustomEvent-detail reist mee naar
    // background, zodat de popup kan tonen wát er herkend werd.
    //
    // v0.4.5 (fix #7, security-audit 2026-09-16) — CustomEvent-spoofing.
    // `bb:tcf-blocked`/`bb:cmp-blocked` worden gedispatcht op `document`,
    // een gedeelde, publieke DOM-node — ELKE willekeurige site-JS kan
    // hetzelfde event zelf dispatchen (`document.dispatchEvent(new
    // CustomEvent('bb:tcf-blocked'))`) en zo de teller/badge/milestones
    // vervalsen. Een écht onvervalsbaar signaal is hier architectonisch niet
    // haalbaar: tcf.content.ts/cmp.content.ts (de legitieme afzenders)
    // draaien bewust in MAIN world om __tcfapi/GPC te kunnen onderscheppen
    // vóórdat de pagina's eigen scripts draaien — en MAIN world is exact
    // dezelfde JS-realm als de pagina zelf. Een geheime marker die wij daar
    // zetten, is voor de pagina even goed leesbaar als voor onszelf; er is
    // geen "MAIN-world-maar-niet-de-pagina"-scheiding om een secret in te
    // verbergen. Zie ook active-flag.ts's eigen limitaties-sectie voor
    // dezelfde grens.
    //
    // Realistische mitigatie i.p.v. onvervalsbaarheid: cap de schade tot
    // hooguit ÉÉN vervalste telling per paginabezoek, i.p.v. onbeperkt
    // kunnen spammen. Vóór deze fix gold die cap alleen voor `bb:cmp-
    // blocked` — `bb:tcf-blocked` had géén enkele limiet en kon dus
    // onbeperkt herhaald worden. Nu geldt de cap voor BEIDE event-types,
    // gedeeld (net als de bestaande "1 weigering per pagina"-bedoeling van
    // de vlag zelf voorschrijft).
    const relay = (event: Event): void => {
      let platform: string | undefined;
      try {
        const detail = (event as CustomEvent<{ platform?: string }>).detail;
        if (detail && typeof detail.platform === 'string') {
          // Defense-in-depth: React escaped dit al bij het renderen (geen
          // XSS-pad), maar begrens/whitelist toch — voorkomt rommel in
          // storage/stats en houdt de popup-UI voorspelbaar.
          platform = detail.platform.replace(/[^\w .-]/g, '').trim().slice(0, 40) || undefined;
        }
      } catch {
        // detail ontbreekt of is niet leesbaar — label is optioneel.
      }
      // v0.4.2 (#170), verbreed in v0.4.5 (fix #7): één weigering per pagina
      // tellen, voor ZOWEL tcf- als cmp-events — niet alleen cmp zoals
      // voorheen. De vlag leeft op de gedeelde ISOLATED-world window (zie
      // autoconsent-layer.ts).
      const w = window as Window & { __bbConsentHandled?: boolean };
      if (w.__bbConsentHandled) return;
      w.__bbConsentHandled = true;
      try {
        void chrome.runtime.sendMessage({ type: 'bb:banner-blocked', platform });
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
