/**
 * OneTrust-handler (CMP ID 411) — enterprise-CMP, o.a. DPG Media, RTL,
 * veel Fortune 500-sites. Documenteerde publieke API (OneTrust Support):
 * `window.OneTrust.RejectAll()` weigert alle niet-noodzakelijke categorieën
 * en verbergt de banner.
 *
 * We wachten niet op de pagina's eigen `window.OptanonWrapper`-callback —
 * die overschrijven zou de site's eigen init-logica breken. In plaats
 * daarvan pollen we zelf op de API, zelfde patroon als de Didomi-handler.
 *
 * DOM-structuur (stabiel over versies):
 *   #onetrust-consent-sdk > #onetrust-banner-sdk
 *   reject-knop: #onetrust-reject-all-handler
 *   accept-knop: #onetrust-accept-btn-handler
 * Script-hosts: cookielaw.org, onetrust.com.
 *
 * Als de API-call om wat voor reden dan ook niet lukt (of niet op tijd
 * beschikbaar komt), klikken we als fallback direct op de reject-knop —
 * die staat sowieso al vast in OneTrust's eigen documentatie en wordt
 * door meerdere onafhankelijke extensies (o.a. AdVoid, ghostery
 * broken-page-reports) als stabiele selector bevestigd.
 */

import type { CmpHandler } from './types.ts';

const LOAD_TIMEOUT_MS = 8000;
const POLL_INTERVAL_MS = 50;

interface OneTrustApi {
  RejectAll?: () => void;
  Close?: () => void;
}

declare global {
  interface Window {
    OneTrust?: OneTrustApi;
  }
}

export const onetrustHandler: CmpHandler = {
  name: 'onetrust',

  detect() {
    if (window.OneTrust) return true;
    if (document.getElementById('onetrust-consent-sdk')) return true;
    if (document.getElementById('onetrust-banner-sdk')) return true;

    const scripts = document.querySelectorAll('script[src]');
    for (const script of scripts) {
      const src = (script as HTMLScriptElement).src;
      if (src.includes('cookielaw.org') || src.includes('onetrust.com')) {
        return true;
      }
    }
    return false;
  },

  async apply() {
    const ot = await waitForOneTrust();
    if (ot && typeof ot.RejectAll === 'function') {
      try {
        ot.RejectAll();
        ot.Close?.();
        return;
      } catch (err) {
        console.warn('[BannerBye] OneTrust.RejectAll failed:', err);
      }
    }

    // Fallback: API niet (op tijd) beschikbaar, maar de banner-DOM kan
    // er alsnog staan (bv. bij trage SDK-init). Probeer de reject-knop
    // direct.
    clickRejectButton();
  },
};

function waitForOneTrust(): Promise<OneTrustApi | null> {
  return new Promise((resolve) => {
    if (window.OneTrust && typeof window.OneTrust.RejectAll === 'function') {
      resolve(window.OneTrust);
      return;
    }

    const start = Date.now();
    const intervalId = window.setInterval(() => {
      if (window.OneTrust && typeof window.OneTrust.RejectAll === 'function') {
        window.clearInterval(intervalId);
        resolve(window.OneTrust);
        return;
      }
      if (Date.now() - start >= LOAD_TIMEOUT_MS) {
        window.clearInterval(intervalId);
        resolve(null);
      }
    }, POLL_INTERVAL_MS);
  });
}

function clickRejectButton(): void {
  const btn = document.getElementById('onetrust-reject-all-handler');
  if (btn instanceof HTMLElement) {
    btn.click();
  }
}
