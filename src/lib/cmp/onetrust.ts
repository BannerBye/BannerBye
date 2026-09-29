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
  IsAlertBoxClosed?: () => boolean;
}

/** Hoe lang we na SDK-load wachten tot de banner zichtbaar wordt. */
const BANNER_WAIT_MS = 2500;

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

    // v0.4.6 (reactormag.com, melding 29-09-2026): alleen weigeren als er
    // écht iets te weigeren valt. Vóór deze fix riep de handler bij élke
    // paginalaad RejectAll() aan — ook als de bezoeker al gekozen had of als
    // OneTrust (bv. het Amerikaanse CPRA-sjabloon dat GPC honoreert) helemaal
    // geen banner toonde. Sites die bij een consentwijziging zelf
    // location.reload() doen (reactormag.com) kwamen zo in een eindeloze
    // herlaadlus: laden → RejectAll → reload → laden → RejectAll → …
    if (ot && typeof ot.IsAlertBoxClosed === 'function') {
      try {
        if (ot.IsAlertBoxClosed()) return;
      } catch {
        // Onbekende SDK-versie — val door naar de zichtbaarheidscheck.
      }
    }
    if (!(await waitForVisibleBanner())) return;

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

function isBannerVisible(): boolean {
  const el = document.getElementById('onetrust-banner-sdk');
  if (!(el instanceof HTMLElement)) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  if (Number(style.opacity) === 0) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function waitForVisibleBanner(): Promise<boolean> {
  return new Promise((resolve) => {
    if (isBannerVisible()) {
      resolve(true);
      return;
    }
    const start = Date.now();
    const intervalId = window.setInterval(() => {
      if (isBannerVisible()) {
        window.clearInterval(intervalId);
        resolve(true);
        return;
      }
      if (Date.now() - start >= BANNER_WAIT_MS) {
        window.clearInterval(intervalId);
        resolve(false);
      }
    }, 100);
  });
}

function clickRejectButton(): void {
  const btn = document.getElementById('onetrust-reject-all-handler');
  if (btn instanceof HTMLElement) {
    btn.click();
  }
}
