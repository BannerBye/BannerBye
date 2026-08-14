/**
 * Usercentrics-handler (CMP ID 5) — dekt beide generaties:
 *
 *  - **v3 / Web CMP** (web.cmp.usercentrics.eu, sinds ~2024; o.a. de
 *    standaard-CMP op Shopify-shops zoals pamo-design.de): exposeert
 *    `window.__ucCmp` met `denyAllConsents()` + `closeCmp()`, en vuurt
 *    het event `UC_CMP_API_READY` zodra de API klaar is. Belangrijk:
 *    v3 definieert GEEN `window.UC_UI` — alleen de events heten nog zo.
 *  - **v2 / Browser UI** (app.usercentrics.eu): exposeert `window.UC_UI`
 *    met `denyAllConsents()` + `closeCMP()`, ready-event `UC_UI_INITIALIZED`.
 *
 * Waarom dit niet aan de autoconsent-laag overgelaten wordt: de
 * `usercentrics-api`-regel begint z'n popup-detectie met een eval
 * (`typeof UC_UI === "object"`) die (a) in onze ISOLATED-laag altijd
 * false oplevert (geen eval-bridge) en (b) op v3-sites sowieso false is.
 * Deze handler draait in MAIN world en praat direct met de API — de
 * banner hoeft niet eens te renderen.
 *
 * Shopify-detail (aanleiding: report pamo-design.de, 2026-08-14): de
 * loader staat er als `<script id="usercentrics-cmp" type="load" d-src=…>`
 * en wordt pas later door Shopify geactiveerd. Daarom wachten we niet
 * alleen met een poll, maar hangen we ook een ready-event-listener op die
 * desnoods ná onze wachttijd alsnog weigert.
 */

import type { CmpHandler } from './types.ts';

/** Ruim — Shopify stelt de loader uit tot idle/interactie. */
const LOAD_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 250;

interface UcV3Api {
  denyAllConsents?: () => Promise<unknown>;
  closeCmp?: () => Promise<unknown>;
}

interface UcV2Api {
  denyAllConsents?: () => unknown;
  closeCMP?: () => unknown;
}

declare global {
  interface Window {
    __ucCmp?: UcV3Api;
    UC_UI?: UcV2Api;
  }
}

/** Weiger alles via welke Usercentrics-API dan ook aanwezig is. */
async function denyViaApi(): Promise<boolean> {
  const v3 = window.__ucCmp;
  if (v3 && typeof v3.denyAllConsents === 'function') {
    try {
      await v3.denyAllConsents();
    } catch (err) {
      console.warn('[BannerBye] __ucCmp.denyAllConsents failed:', err);
      return false;
    }
    try {
      await v3.closeCmp?.();
    } catch {
      // Banner sluit meestal al door de deny zelf — niet kritisch.
    }
    return true;
  }

  const v2 = window.UC_UI;
  if (v2 && typeof v2.denyAllConsents === 'function') {
    try {
      v2.denyAllConsents();
    } catch (err) {
      console.warn('[BannerBye] UC_UI.denyAllConsents failed:', err);
      return false;
    }
    try {
      v2.closeCMP?.();
    } catch {
      // idem
    }
    return true;
  }

  return false;
}

function apiPresent(): boolean {
  return (
    typeof window.__ucCmp?.denyAllConsents === 'function' ||
    typeof window.UC_UI?.denyAllConsents === 'function'
  );
}

/**
 * Wacht tot een Usercentrics-API beschikbaar is: ready-events als primaire
 * route, poll als vangnet. Resolvet false na timeout.
 */
function waitForApi(): Promise<boolean> {
  return new Promise((resolve) => {
    if (apiPresent()) {
      resolve(true);
      return;
    }

    let settled = false;
    const settle = (found: boolean): void => {
      if (settled) return;
      settled = true;
      window.clearInterval(intervalId);
      resolve(found);
    };

    // v3 vuurt UC_CMP_API_READY, v2 vuurt UC_UI_INITIALIZED.
    const onReady = (): void => settle(true);
    window.addEventListener('UC_CMP_API_READY', onReady, { once: true });
    window.addEventListener('UC_UI_INITIALIZED', onReady, { once: true });

    const start = Date.now();
    const intervalId = window.setInterval(() => {
      if (apiPresent()) {
        settle(true);
        return;
      }
      if (Date.now() - start >= LOAD_TIMEOUT_MS) {
        settle(false);
      }
    }, POLL_INTERVAL_MS);
  });
}

export const usercentricsHandler: CmpHandler = {
  name: 'usercentrics',

  detect() {
    if (window.__ucCmp || window.UC_UI) return true;

    // v3-loader-tag (ook als 'ie nog niet uitgevoerd is — Shopify zet 'm
    // op type="load"/d-src en activeert 'm later).
    if (document.getElementById('usercentrics-cmp')) return true;
    if (document.getElementById('usercentrics-root')) return true;
    if (document.getElementById('usercentrics-cmp-ui')) return true;

    const scripts = document.querySelectorAll('script');
    for (const script of scripts) {
      const src =
        (script as HTMLScriptElement).src ||
        script.getAttribute('d-src') ||
        '';
      if (src.includes('usercentrics.eu') || src.includes('usercentrics.com')) {
        return true;
      }
    }
    return false;
  },

  async apply() {
    const ready = await waitForApi();
    if (ready) {
      await denyViaApi();
      return;
    }

    // Timeout — maar Shopify kan de loader nog altijd later activeren.
    // Laat een passieve listener achter die dan alsnog weigert. (De
    // teller is op dit punt al gemeld; dat is dezelfde afweging als de
    // bestaande Didomi-handler maakt bij z'n stille timeout.)
    const lateDeny = (): void => {
      void denyViaApi();
    };
    window.addEventListener('UC_CMP_API_READY', lateDeny, { once: true });
    window.addEventListener('UC_UI_INITIALIZED', lateDeny, { once: true });
  },
};
