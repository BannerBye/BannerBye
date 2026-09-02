/**
 * TrustArc-handler — enterprise/US-CMP. LET OP: dit is de minst zekere
 * van de vijf CMP-handlers, met opzet zo gedocumenteerd.
 *
 * TrustArc publiceert géén programmatische reject/accept-API. Bevestigd
 * via twee bronnen tijdens het bouwen van deze handler:
 *  - de officiële "Consent Manager Deployment Guide" (TrustArc Help
 *    Center) beschrijft alleen de deployment (containers + loader-
 *    script), geen JS-methodes
 *  - libconsent's TrustArc-adapter-docs zeggen het expliciet: "TrustArc
 *    exposes no way to accept or reject programmatically"
 * Er is dus geen `window.TrustArc.RejectAll()`-achtige call zoals bij
 * OneTrust/Cookiebot/Didomi/Usercentrics om op te wachten.
 *
 * Wat wél gedocumenteerd/geverifieerd is:
 *  - banner-container: #consent_blackbar (banner-stijl "bb") of
 *    #teconsent (widget-stijl), geladen via een script op
 *    consent.trustarc.com/notice?domain=...
 *  - sommige installaties tonen direct een reject-knop in de banner
 *    zelf, andere tonen alleen "accept" + een link naar het
 *    preference-center waar de eigenlijke weiger-optie zit
 *
 * Deze handler doet een best-effort DOM-klik op selectors die door
 * meerdere onafhankelijke, actief onderhouden browserextensies worden
 * gebruikt (FSB/fullselfbrowsing, ByeBar, CookieBlockerExtension,
 * AIGDPR) — niet uit TrustArc's eigen docs, die geen selectors
 * publiceren. Matcht niets, dan doet deze handler niets: de generieke
 * auto-click fallback (layer 5) pakt op basis van zichtbare knoptekst
 * eventueel alsnog op.
 *
 * Niet claimen dat TrustArc "volledig" ondersteund wordt totdat dit
 * empirisch getest is tegen een live TrustArc-site.
 */

import type { CmpHandler } from './types.ts';

const OBSERVE_TIMEOUT_MS = 8000;

/** Zie het bronnenoverzicht in de bestandskop hierboven. */
const REJECT_SELECTORS = [
  '.trustarc-reject-all',
  '#truste-consent-required',
  '.trustarc-manage-btn',
] as const;

const CONTAINER_SELECTORS = ['#consent_blackbar', '#teconsent'] as const;

export const trustarcHandler: CmpHandler = {
  name: 'trustarc',

  detect() {
    for (const sel of CONTAINER_SELECTORS) {
      if (document.querySelector(sel)) return true;
    }

    const scripts = document.querySelectorAll('script[src]');
    for (const script of scripts) {
      const src = (script as HTMLScriptElement).src;
      if (src.includes('trustarc.com')) return true;
    }
    return false;
  },

  async apply() {
    const clicked = await waitAndClickReject();
    if (!clicked) {
      console.warn(
        '[BannerBye] TrustArc gedetecteerd maar geen bekende reject-knop gevonden — laat over aan de generieke fallback.',
      );
    }
  },
};

function tryClick(): boolean {
  for (const sel of REJECT_SELECTORS) {
    const el = document.querySelector(sel);
    if (el instanceof HTMLElement) {
      el.click();
      return true;
    }
  }
  return false;
}

/**
 * TrustArc's widget rendert async in de containers. We proberen direct,
 * en observeren daarna DOM-mutaties tot de knop verschijnt of de
 * timeout verstrijkt — zelfde aanpak als de andere handlers' poll-loop,
 * maar op DOM-structuur i.p.v. een API-object omdat die hier ontbreekt.
 */
function waitAndClickReject(): Promise<boolean> {
  return new Promise((resolve) => {
    if (tryClick()) {
      resolve(true);
      return;
    }

    let settled = false;
    const settle = (result: boolean): void => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      window.clearTimeout(timeoutId);
      resolve(result);
    };

    const observer = new MutationObserver(() => {
      if (tryClick()) settle(true);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    const timeoutId = window.setTimeout(() => settle(false), OBSERVE_TIMEOUT_MS);
  });
}
