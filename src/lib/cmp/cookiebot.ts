/**
 * Cookiebot-handler (CMP ID 14) — veel gebruikt door SMB/EU-sites.
 * Documenteerde publieke API (Cookiebot developer docs):
 * `window.Cookiebot.decline()` — "Rejects all cookies (decline), and
 * hides the Cookiebot dialog."
 *
 * Ready-events (typische volgorde): CookiebotOnLoad →
 * CookiebotOnDialogInit → CookiebotOnDialogDisplay →
 * CookiebotOnConsentReady. We luisteren op de vroegste bruikbare
 * (`CookiebotOnDialogInit`) plus `CookiebotOnLoad`, met een poll-vangnet
 * — zelfde patroon als de Didomi-handler.
 *
 * DOM-fallback: dialog #CybotCookiebotDialog, decline-knop
 * #CybotCookiebotDialogBodyButtonDecline (standaard Cookiebot-ID,
 * bevestigd stabiel over installaties). Script-host: cookiebot.com /
 * consent.cookiebot.com.
 */

import type { CmpHandler } from './types.ts';

const LOAD_TIMEOUT_MS = 8000;
const POLL_INTERVAL_MS = 50;

interface CookiebotApi {
  decline?: () => void;
}

declare global {
  interface Window {
    Cookiebot?: CookiebotApi;
  }
}

export const cookiebotHandler: CmpHandler = {
  name: 'cookiebot',

  detect() {
    if (window.Cookiebot) return true;
    if (document.getElementById('CybotCookiebotDialog')) return true;

    const scripts = document.querySelectorAll('script[src]');
    for (const script of scripts) {
      const src = (script as HTMLScriptElement).src;
      if (src.includes('consent.cookiebot.com') || src.includes('cookiebot.com')) {
        return true;
      }
    }
    return false;
  },

  async apply() {
    const cb = await waitForCookiebot();
    if (cb && typeof cb.decline === 'function') {
      try {
        cb.decline();
        return;
      } catch (err) {
        console.warn('[BannerBye] Cookiebot.decline failed:', err);
      }
    }

    // Fallback: API nog niet klaar, maar de dialog-DOM staat er al.
    clickDeclineButton();
  },
};

function apiPresent(): boolean {
  return typeof window.Cookiebot?.decline === 'function';
}

function waitForCookiebot(): Promise<CookiebotApi | null> {
  return new Promise((resolve) => {
    if (apiPresent()) {
      resolve(window.Cookiebot ?? null);
      return;
    }

    let settled = false;
    const settle = (): void => {
      if (settled) return;
      settled = true;
      window.clearInterval(intervalId);
      resolve(apiPresent() ? (window.Cookiebot ?? null) : null);
    };

    window.addEventListener('CookiebotOnDialogInit', settle, { once: true });
    window.addEventListener('CookiebotOnLoad', settle, { once: true });

    const start = Date.now();
    const intervalId = window.setInterval(() => {
      if (apiPresent()) {
        settle();
        return;
      }
      if (Date.now() - start >= LOAD_TIMEOUT_MS) {
        settle();
      }
    }, POLL_INTERVAL_MS);
  });
}

function clickDeclineButton(): void {
  const btn = document.getElementById('CybotCookiebotDialogBodyButtonDecline');
  if (btn instanceof HTMLElement) {
    btn.click();
  }
}
