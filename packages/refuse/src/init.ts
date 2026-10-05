/**
 * @bannerbye/refuse — document_start-script (Playwright `addInitScript`,
 * Puppeteer `evaluateOnNewDocument`).
 *
 * Doet wat laag 1 en 2 van de extensie doen, vóór de eerste regel van de
 * site draait: een geldige IAB TCF v2.2-weigerstring op `__tcfapi` en in
 * `euconsent-v2`, en `navigator.globalPrivacyControl = true`. Een site die
 * TCF spreekt ziet dan een bestaand antwoord en tekent geen banner. De
 * Sec-GPC-header zelf hoort bij de HTTP-laag; zie `prepare()` in index.ts.
 *
 * Vereenvoudigde stub t.o.v. src/entrypoints/tcf.content.ts: geen
 * CMP-delegatie, geen tellers — een testbrowser heeft geen popup.
 */
import { buildNoConsentTCData, type TCData } from '../../../src/lib/tcf/tcdata.ts';

type TcfCallback = (returnValue: unknown, success: boolean) => void;

(() => {
  const w = window as Window & { __tcfapi?: unknown; __bannerbyeInit?: boolean };
  if (w.__bannerbyeInit) return;
  w.__bannerbyeInit = true;

  try {
    Object.defineProperty(navigator, 'globalPrivacyControl', { get: () => true, configurable: true });
  } catch {
    // Niet kritiek.
  }

  const tcData: TCData = buildNoConsentTCData({ consentLanguage: 'EN', publisherCC: 'AA', cmpVersion: 1 });
  try {
    document.cookie = `euconsent-v2=${tcData.tcString}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
  } catch {
    // about:blank e.d.
  }

  const listeners = new Map<number, TcfCallback>();
  let nextId = 1;
  const clone = (): TCData => JSON.parse(JSON.stringify(tcData)) as TCData;

  const tcfapi = (command: string, _version: number, callback: TcfCallback, parameter?: unknown): void => {
    if (typeof callback !== 'function') return;
    switch (command) {
      case 'ping':
        callback(
          {
            gdprApplies: tcData.gdprApplies,
            cmpLoaded: true,
            cmpStatus: 'loaded',
            displayStatus: 'hidden',
            apiVersion: '2.2',
            cmpVersion: tcData.cmpVersion,
            cmpId: tcData.cmpId,
            gvlVersion: 1,
            tcfPolicyVersion: tcData.tcfPolicyVersion,
          },
          true,
        );
        return;
      case 'getTCData':
      case 'getInAppTCData':
        callback(clone(), true);
        return;
      case 'addEventListener': {
        const id = nextId++;
        listeners.set(id, callback);
        const data = clone() as TCData & { listenerId: number };
        data.listenerId = id;
        callback(data, true);
        return;
      }
      case 'removeEventListener': {
        const id = parameter as number;
        const had = listeners.delete(id);
        callback(had, had);
        return;
      }
      default:
        callback(null, false);
    }
  };

  if (typeof w.__tcfapi !== 'function') {
    try {
      Object.defineProperty(w, '__tcfapi', { value: tcfapi, writable: true, configurable: true });
    } catch {
      w.__tcfapi = tcfapi;
    }
  }

  // Locator-frame voor oudere TCF-clients die via postMessage praten.
  try {
    if (!w.frames['__tcfapiLocator' as unknown as number] && document.body) {
      const f = document.createElement('iframe');
      f.name = '__tcfapiLocator';
      f.style.display = 'none';
      document.body.appendChild(f);
    }
  } catch {
    // Niet kritiek.
  }
  w.addEventListener('message', (ev: MessageEvent) => {
    let msg: { __tcfapiCall?: { command: string; version: number; callId: string | number; parameter?: unknown } } | null = null;
    try {
      msg = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data;
    } catch {
      return;
    }
    const call = msg && msg.__tcfapiCall;
    if (!call) return;
    tcfapi(call.command, call.version, (returnValue, success) => {
      const ret = { __tcfapiReturn: { callId: call.callId, command: call.command, returnValue, success } };
      try {
        (ev.source as Window | null)?.postMessage(typeof ev.data === 'string' ? JSON.stringify(ret) : ret, '*');
      } catch {
        // Niet kritiek.
      }
    }, call.parameter);
  });
})();
