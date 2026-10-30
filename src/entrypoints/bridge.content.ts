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
import { STATE_MARKER_KEY, writeStateMarker, computeStateForHost } from '@/lib/active-flag.ts';
import { TRACE_EVENT, MAX_STEPS, cleanTraceMsg, isTraceLayer } from '@/lib/trace.ts';

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
      const w = window as Window & { __bbConsentHandled?: boolean; __bbCounted?: boolean };
      if (w.__bbCounted) return;
      w.__bbCounted = true;
      // v0.4.14 (raiplay.it, melding 30 okt 2026): een `bb:tcf-blocked` is
      // GEEN bewijs dat de banner weg is. Dat event vuurt zodra een vendor
      // (Google IMA op raiplay.it, 30 ms na start) ons __tcfapi-antwoord
      // ophaalt — nog vóór de CMP van de site (Avacy/OIL) zich installeert
      // en alsnog een banner rendert. Tot 0.4.13 zette dit pad
      // __bbConsentHandled, waarop laag 5 de pagina met rust liet en de
      // zichtbare "Continua senza accettare" nooit klikte. Alleen een
      // CMP-handler-weigering (bb:cmp-blocked, de API van de CMP zelf) mag
      // laag 5 uitschakelen; de TCF-laag telt wél (één keer per pagina).
      if (event.type === 'bb:cmp-blocked') w.__bbConsentHandled = true;
      try {
        void chrome.runtime.sendMessage({ type: 'bb:banner-blocked', platform, t: Math.round(performance.now()) });
      } catch {
        // Background-worker idle of ander runtime-probleem — niet kritiek.
      }
    };

    // Belangrijk: listen op `document`, niet `window`. Events op window
    // flowen NIET cross-world in Chrome MV3 (MAIN-world TCF/CMP scripts
    // dispatchen op document zodat onze ISOLATED bridge ze ook hoort).
    document.addEventListener('bb:tcf-blocked', relay);
    document.addEventListener('bb:cmp-blocked', relay);

    // v0.4.12: trace-regels uit de MAIN-world lagen (gpc/tcf/cmp) doorgeven
    // aan de background — zie lib/trace.ts. Zelfde spoofing-overweging als
    // hierboven: een pagina kan dit event ook dispatchen, maar de trace stuurt
    // niets aan (alleen tonen), en de cap per pagina begrenst de rommel.
    let traceCount = 0;
    document.addEventListener(TRACE_EVENT, (event: Event) => {
      if (traceCount >= MAX_STEPS) return;
      let layer: unknown;
      let msg = '';
      let t = 0;
      try {
        const detail = (event as CustomEvent<{ layer?: unknown; msg?: unknown; t?: unknown }>).detail;
        layer = detail?.layer;
        msg = cleanTraceMsg(detail?.msg);
        t = typeof detail?.t === 'number' ? detail.t : Math.round(performance.now());
      } catch {
        return;
      }
      if (!isTraceLayer(layer) || !msg) return;
      traceCount++;
      try {
        void chrome.runtime.sendMessage({ type: TRACE_EVENT, layer, msg, t });
      } catch {
        // niet kritiek
      }
    });

    // v0.4.6: houd de synchrone state-marker voor deze origin gelijk aan de
    // instellingen (per-site pauze + globale schakelaar), zodat de MAIN-world
    // lagen op Safari/Firefox (statische manifest-scripts) die bij de
    // volgende paginalaad kunnen lezen. Zie readActiveState() in active-flag.
    void computeStateForHost(location.hostname)
      .then((state) => writeStateMarker(state, STATE_MARKER_KEY))
      .catch(() => {
        // Opslag niet leesbaar — marker laten zoals hij is.
      });
  },
});
