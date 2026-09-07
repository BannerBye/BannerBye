/**
 * BannerBye — TCF v2.2 stub installer.
 *
 * Wordt in MAIN world geladen op `document_start`, vóór elke andere
 * page-script. Definieert `window.__tcfapi(command, version, callback,
 * parameter)` conform IAB CMP API v2.2.
 *
 * Drie kanalen waarmee sites onze "no consent" status zien:
 *   1. Direct call: `window.__tcfapi('getTCData', 2, fn)` → fn(tcData, true)
 *   2. Cross-frame postMessage protocol via `__tcfapiLocator` iframe
 *   3. `euconsent-v2` cookie voor cookie-based detection
 *
 * Spec:
 *   https://github.com/InteractiveAdvertisingBureau/GDPR-Transparency-and-Consent-Framework/blob/master/TCFv2/IAB%20Tech%20Lab%20-%20CMP%20API%20v2.md
 *
 * Belangrijk:
 *  - `world: 'MAIN'` is verplicht — sites verwachten __tcfapi op de
 *    eigen window, niet op een geïsoleerde extension-window.
 *  - `runAt: 'document_start'` zorgt dat we vóór page-scripts in <head>
 *    binnen zijn. Sommige sites roepen __tcfapi al synchroon aan.
 *  - GEEN chrome.* APIs hier — die bestaan niet in MAIN world.
 *  - Per-site pause: voor v0.1 is de stub altijd geïnstalleerd zolang
 *    de extensie globaal aan staat. Toggle-off via background unregister
 *    (volgende iteratie). Op gepauzeerde sites geeft het signaal nog
 *    steeds "no consent" maar dat is voor consent-pagina's geen issue.
 */

import { defineContentScript } from 'wxt/sandbox';
import { buildNoConsentTCData, type TCData } from '@/lib/tcf/tcdata.ts';
import { readActiveState } from '@/lib/active-flag.ts';
import { isPdfDocument } from '@/lib/pdf-guard.ts';

/** Response shape voor `__tcfapi('ping', ...)`. */
interface PingResponse {
  gdprApplies: boolean;
  cmpLoaded: boolean;
  cmpStatus: 'loaded' | 'stub';
  displayStatus: 'visible' | 'hidden' | 'disabled';
  apiVersion: '2.2';
  cmpVersion: number;
  cmpId: number;
  gvlVersion: number;
  tcfPolicyVersion: number;
}

/** Een TCF callback krijgt (returnValue, success). */
type TcfCallback = (returnValue: unknown, success: boolean) => void;

/**
 * Functietype voor `window.__tcfapi`. We staan elke command toe
 * als string — TCF v2.2 commands zijn stringly-typed in de spec.
 */
type TcfApi = (
  command: string,
  version: number,
  callback: TcfCallback,
  parameter?: unknown,
) => void;

/** Cross-frame postMessage envelope (older TCF clients). */
interface TcfPostMessageCall {
  __tcfapiCall: {
    command: string;
    version: number;
    callId: string | number;
    parameter?: unknown;
  };
}

interface TcfPostMessageReturn {
  __tcfapiReturn: {
    callId: string | number;
    command: string;
    returnValue: unknown;
    success: boolean;
  };
}

/** Marker zodat we onszelf niet overschrijven bij dubbele injectie. */
type TaggedTcfApi = TcfApi & { __bannerbye?: boolean };

declare global {
  interface Window {
    __tcfapi?: TaggedTcfApi;
  }
}

export default defineContentScript({
  // v0.2.0 (#111): op Chrome MV3 registreren we dit script dynamisch vanuit
  // background.ts (chrome.scripting.registerContentScripts) zodat we de
  // volgorde t.o.v. de flag-setters kunnen garanderen. Manifest-static
  // scripts runnen volgens Chrome-spec vóór dynamic scripts in dezelfde
  // world + run_at — dat veroorzaakte de race in eerste #111-poging.
  // Voor MV2 (Firefox/Safari) blijft manifest-registratie: chrome.scripting
  // registerContentScripts bestaat daar niet, real-toggle blijft tot v0.3.0
  // een known limitation.
  matches:
    (import.meta as unknown as { env: { BROWSER: string } }).env.BROWSER === 'chrome'
      ? ['https://_bb_runtime_only_.invalid/*']
      : ['<all_urls>'],
  // v0.1.2: skip PDF-viewer routes — de __tcfapi spoof en cookie-pre-set
  // breken sites zoals Lyanthe's PdfViewer.aspx die consent-checks doen
  // vóór de PDF-iframe wordt geladen. Match-patterns zijn case-sensitive
  // in MV3, dus alle waarschijnlijke varianten meenemen.
  // v0.1.4: enterprise SaaS-platforms zonder cookie-banners maar mét
  // ingebouwde TCF-aware PDF-viewers (Exact Online → PDF black-screen
  // op /Boeking/Inkoopboek). BannerBye heeft daar niets te doen — geen
  // cookie banners — dus complete uitsluiting is veiliger dan symptomatic
  // fixes per URL-pattern.
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
    // v0.1.4: enterprise SaaS hosts
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

    // === ACTIVE-FLAG CHECK (v0.2.0) ===
    // Background heeft net voor onze injectie een MAIN-world script
    // gerund dat window.__bannerbyeState heeft gezet. Als die state
    // niet 'active' is (globaal uit, of host gepauzeerd), doen we
    // niets — geen __tcfapi-spoof, geen euconsent-v2 cookie, geen
    // locator-frame. Bestaande pagina-CMP werkt dan zoals voorheen.
    if (readActiveState() !== 'active') {
      return;
    }

    // === RE-ENTRY GUARD ===
    // Als een echte CMP al __tcfapi heeft gezet (publisher heeft eigen
    // CMP geïnstalleerd) — niet overschrijven, om hun flow niet te breken.
    // De gebruiker kan dan via popup BannerBye pausen voor die site.
    if (typeof window.__tcfapi === 'function') {
      return;
    }

    // === BUILD TCDATA ===
    // Wordt eenmalig opgebouwd bij script-start. De tcString embeddt
    // timestamps van nu — accuraat genoeg voor het hele page-leven.
    const tcData = buildNoConsentTCData({
      consentLanguage: 'EN',
      publisherCC: 'AA',
      cmpId: 0,
      cmpVersion: 1,
      vendorListVersion: 1,
    });

    const listeners = new Map<number, TcfCallback>();
    let nextListenerId = 1;

    // v0.2.0 (#114): track of we al een teller-event hebben uitgestuurd
    // voor deze pageload. Sites kunnen __tcfapi tientallen keren per page
    // aanroepen — we tellen er één keer, bij de eerste "betekenisvolle"
    // call (getTCData of addEventListener). bridge.content.ts pickt het op
    // en stuurt 'bb:banner-blocked' naar background.
    let blockedReported = false;
    const reportBlocked = (): void => {
      if (blockedReported) return;
      blockedReported = true;
      try {
        // Belangrijk: dispatch op `document`, niet `window`. Events op
        // window flowen NIET cross-world in Chrome MV3 (MAIN ↔ ISOLATED
        // hebben aparte window-listeners). Document delen ze wel.
        document.dispatchEvent(
          new CustomEvent('bb:tcf-blocked', {
            // v0.4.0: platform-label voor de activiteitenlijst in de popup.
            detail: { platform: 'IAB TCF' },
          }),
        );
      } catch {
        // CustomEvent kan in oude/exotische contexts falen — niet kritiek.
      }
    };

    // === __tcfapi IMPLEMENTATIE ===
    // v0.4.2 (#170, 7 sep, tweede iteratie): `ownStub` is ons reject-all-
    // antwoord; `tcfapi` (hieronder) is wat de pagina ziet en delegeert naar
    // de CMP van de site zodra die zichzelf heeft geïnstalleerd (zie de
    // setter bij INSTALL OP WINDOW). Vóór dat moment — en op sites zonder
    // TCF-CMP: altijd — antwoorden wij.
    let cmpImpl: TcfApi | null = null;

    const ownStub: TcfApi = function ownStub(command, _version, callback, parameter) {
      if (typeof callback !== 'function') return;

      switch (command) {
        case 'ping': {
          const ping: PingResponse = {
            gdprApplies: tcData.gdprApplies,
            cmpLoaded: true,
            cmpStatus: 'loaded',
            displayStatus: 'hidden',
            apiVersion: '2.2',
            cmpVersion: tcData.cmpVersion,
            cmpId: tcData.cmpId,
            gvlVersion: 1,
            tcfPolicyVersion: tcData.tcfPolicyVersion,
          };
          callback(ping, true);
          return;
        }

        case 'getTCData': {
          // De optionele `parameter` is een lijst vendor-IDs waarvoor
          // we consent-status mogen rapporteren. Wij hebben sowieso
          // geen consent voor enige vendor — dus we negeren de filter.
          callback(cloneTCData(tcData), true);
          reportBlocked();
          return;
        }

        case 'addEventListener': {
          const id = nextListenerId++;
          listeners.set(id, callback);
          const data = cloneTCData(tcData) as TCData & { listenerId: number };
          data.listenerId = id;
          callback(data, true);
          reportBlocked();
          return;
        }

        case 'removeEventListener': {
          const id = parameter as number;
          if (typeof id === 'number' && listeners.has(id)) {
            listeners.delete(id);
            callback(true, true);
          } else {
            callback(false, false);
          }
          return;
        }

        case 'getInAppTCData': {
          // Native-app variant; we serveren hetzelfde object.
          callback(cloneTCData(tcData), true);
          return;
        }

        case 'getVendorList': {
          // We hosten geen eigen vendor-list. Sites moeten de officiële
          // IAB GVL gebruiken (vendor-list.consensu.org).
          callback(null, false);
          return;
        }

        default: {
          // Onbekende command. Spec zegt: callback(null, false).
          callback(null, false);
        }
      }
    };

    // Wat de pagina daadwerkelijk aanroept: delegeer naar de CMP van de site
    // zodra die er is, anders ons eigen antwoord.
    const tcfapi: TaggedTcfApi = function tcfapi(command, version, callback, parameter) {
      if (cmpImpl) {
        try {
          cmpImpl(command, version, callback, parameter);
          return;
        } catch {
          // CMP-implementatie gooit — val terug op ons antwoord.
        }
      }
      ownStub(command, version, callback, parameter);
    };

    tcfapi.__bannerbye = true;

    // === INSTALL OP WINDOW ===
    // Accessor-property (getter/setter) met configurable:false zodat sites
    // onze stub niet kunnen overschrijven met hun eigen "yes consent"-versie.
    //
    // v0.4.2 (#170/#215, 7 sep 2026) — WAAROM EEN SETTER EN GEEN
    // `writable: false`-dataproperty: de IAB-referentiebibliotheek
    // (@iabtechlabtcf/cmpapi, gebruikt door o.a. Sourcepoint en DPG Media's
    // consent.js) installeert zichzelf met een kale toewijzing
    // `window.__tcfapi = this.apiCall.bind(this)` in een `finally`-blok, in
    // strict mode. Op een niet-schrijfbare dataproperty gooit dat een
    // TypeError ("Cannot assign to read only property '__tcfapi'") die de
    // CMP-initialisatie halverwege afbreekt. Gevolgen, allemaal in Robins
    // echte Chrome vastgesteld: derstandard.at stuurt door naar een
    // "schakel je browser-add-ons uit"-pagina (Sourcepoint-wrapper logt
    // "ERROR in messagingWithoutDetection"), DPG's accept-or-pay-muur
    // (ad.nl/telegraaf.nl) rendert niet — een schending van de ethos dat
    // zo'n muur zichtbaar moet blijven — en Sourcepoint-banners op
    // theguardian.com/spiegel.de "verdwenen" niet dankzij ons signaal maar
    // omdat hun CMP crashte.
    //
    // Tweede iteratie (zelfde dag, hertest in Robins Chrome): een setter die
    // de toewijzing stilzwijgend NEGEERT is óók niet genoeg. Sourcepoint's
    // wrapper praat na installatie via `window.__tcfapi` met zichzelf
    // (eigen commands, 'useractioncomplete'-events); krijgt hij daar ons
    // statische reject-all op, dan rondt hij een keuze nooit af — heise.de
    // kwam zo in een reload-lus: weigering door de motor → Sourcepoint
    // herlaadt de pagina → keuze niet opgeslagen (geen consentUUID) →
    // banner opnieuw → weigering → … elke 2-8 s. Daarom: de setter BEWAART
    // de implementatie van de site en `tcfapi` delegeert er vanaf dat moment
    // naartoe. Ons reject-all geldt dus in het venster vóór de CMP zich
    // installeert (precies waar "before they load" over gaat) en permanent op
    // sites zonder TCF-CMP; daarna is de CMP zelf de bron — en die staat na
    // laag 3/4/5 op "geweigerd". `configurable: false` blijft: `delete`/
    // `defineProperty` op onze stub gooit nog steeds, maar dat pad gebruikt
    // geen enkele bekende CMP voor de installatie zelf.
    //
    // Sommige pagina's pre-freezen window of hebben al een getter/setter —
    // vandaar de fallback naar directe assignment.
    try {
      Object.defineProperty(window, '__tcfapi', {
        get: () => tcfapi,
        set: (value: unknown) => {
          if (typeof value === 'function' && value !== tcfapi) {
            cmpImpl = value as TcfApi;
          }
        },
        enumerable: true,
        configurable: false,
      });
    } catch {
      try {
        window.__tcfapi = tcfapi;
      } catch {
        // Geef het op — site heeft window dichtgetimmerd.
        return;
      }
    }

    // === __tcfapiLocator IFRAME ===
    // Sommige CMPs gebruiken het oudere postMessage-protocol: ze posten
    // een bericht naar een frame met name "__tcfapiLocator" en luisteren
    // op response. Wij installeren dat frame zodat ze ons vinden.
    const installLocator = (): void => {
      try {
        if (document.querySelector('iframe[name="__tcfapiLocator"]')) {
          return;
        }
        const frame = document.createElement('iframe');
        frame.style.cssText = 'display:none; width:0; height:0; border:0;';
        frame.name = '__tcfapiLocator';
        const parent = document.body || document.documentElement;
        parent?.appendChild(frame);
      } catch {
        // Niet kritiek — direct __tcfapi calls werken nog steeds.
      }
    };

    if (document.body || document.documentElement) {
      installLocator();
    } else {
      window.addEventListener('DOMContentLoaded', installLocator, { once: true });
    }

    // === postMessage LISTENER ===
    // Cross-frame protocol: ander frame stuurt {__tcfapiCall: {...}},
    // wij sturen {__tcfapiReturn: {...}} terug naar source.
    window.addEventListener('message', (event: MessageEvent) => {
      let msg: TcfPostMessageCall | null = null;
      try {
        const raw = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (raw && typeof raw === 'object' && '__tcfapiCall' in raw) {
          msg = raw as TcfPostMessageCall;
        }
      } catch {
        return;
      }
      if (!msg) return;

      const call = msg.__tcfapiCall;
      tcfapi(
        call.command,
        call.version,
        (returnValue, success) => {
          const response: TcfPostMessageReturn = {
            __tcfapiReturn: {
              callId: call.callId,
              command: call.command,
              returnValue,
              success,
            },
          };
          if (event.source && 'postMessage' in event.source) {
            // Echo back het encoderingsformat (string in → string uit).
            const data = typeof event.data === 'string' ? JSON.stringify(response) : response;
            (event.source as Window).postMessage(data, event.origin || '*');
          }
        },
        call.parameter,
      );
    });

    // === COOKIE PRE-SET ===
    // `euconsent-v2` is de standaardnaam voor de TCF-cookie. Sites die
    // hun banner-logica baseren op cookie-aanwezigheid (ipv API-call)
    // zien zo direct dat er een geldige consent-decision is.
    //
    // v0.4.2 (#170): alleen zetten als er nog géén euconsent-v2 staat. Zodra
    // een CMP (na de weigering door laag 3/4/5) zijn eigen TC-string heeft
    // opgeslagen, moet die blijven staan — overschrijven bij elke paginalaad
    // maakt de opgeslagen keuze voor de CMP onherkenbaar en lokt precies de
    // "banner komt steeds terug"-lus uit.
    try {
      if (!/(?:^|;\s*)euconsent-v2=/.test(document.cookie)) {
        const oneYear = 365 * 24 * 60 * 60;
        document.cookie = `euconsent-v2=${tcData.tcString}; path=/; max-age=${oneYear}; SameSite=Lax`;
      }
    } catch {
      // Sommige contexten (sandboxed iframe) staan cookies niet toe.
    }
  },
});

/**
 * Diepe kloon van een TCData-object.
 *
 * We geven elke caller een eigen kopie zodat ze niet per ongeluk
 * (of bewust) onze interne state kunnen wijzigen via mutatie.
 */
function cloneTCData(tcData: TCData): TCData {
  return JSON.parse(JSON.stringify(tcData)) as TCData;
}
