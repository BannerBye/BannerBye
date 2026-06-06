/**
 * Didomi-handler.
 *
 * Didomi (CMP ID 7, sdk.privacy-center.org) gebruikt een eigen
 * `didomi_token`-cookie voor consent-persistentie. Pure TCF-string
 * via `euconsent-v2` accepteert hun SDK wel (geen decode-error)
 * maar ze tonen alsnog hun banner als hun eigen token ontbreekt.
 *
 * Voor v0.1 doen we een reactieve aanpak: we wachten tot
 * `window.Didomi` is geladen en gebruiken hun publieke API om
 * "disagree to all" te zetten en de banner te verbergen. De banner
 * verschijnt heel kort — niet zo puur preventief als onze TCF-stub
 * voor andere sites, maar wél effectief op nrc.nl en alle andere
 * Didomi-sites.
 *
 * v0.2 idee: reverse-engineer Didomi's token-format en pre-set
 * `didomi_token` cookie at document_start. Dan zou ze SDK direct
 * skippen. Voor nu: works, ship it.
 *
 * Didomi API-docs:
 *   https://developers.didomi.io/cmp/web-sdk/reference
 */

import type { CmpHandler } from './types.ts';

const LOAD_TIMEOUT_MS = 5000;
const POLL_INTERVAL_MS = 50;

interface DidomiNotice {
  hide?: () => void;
}

interface DidomiApi {
  setUserDisagreeToAll?: () => void;
  notice?: DidomiNotice;
}

declare global {
  interface Window {
    Didomi?: DidomiApi;
    didomiOnReady?: Array<(d: DidomiApi) => void>;
  }
}

export const didomiHandler: CmpHandler = {
  name: 'didomi',

  detect() {
    // Drie signalen — als één klopt, gaan we 'm aanvliegen.
    if (window.Didomi) return true;
    if (window.didomiOnReady) return true;

    // Script-tag-detectie. Didomi-loaders zitten op verschillende
    // CDN-paths afhankelijk van de tenant.
    const scripts = document.querySelectorAll('script[src]');
    for (const script of scripts) {
      const src = (script as HTMLScriptElement).src;
      if (
        src.includes('sdk.privacy-center.org') ||
        src.includes('.privacy-center.org/loader') ||
        src.includes('didomi.io')
      ) {
        return true;
      }
    }
    return false;
  },

  async apply() {
    const didomi = await waitForDidomi();
    if (!didomi) {
      // SDK is nooit beschikbaar gekomen binnen timeout — site
      // gebruikt waarschijnlijk geen actieve Didomi-CMP.
      return;
    }

    // Stuur expliciet "disagree to all" via de SDK. Dit zet hun
    // proprietaire `didomi_token` cookie + triggert een TCF-update.
    try {
      didomi.setUserDisagreeToAll?.();
    } catch (err) {
      console.warn('[BannerBye] Didomi.setUserDisagreeToAll failed:', err);
    }

    // Verberg de banner expliciet. setUserDisagreeToAll doet dit
    // meestal al, maar sommige Didomi-versies laten de banner
    // staan tot je expliciet hide() callt.
    try {
      didomi.notice?.hide?.();
    } catch {
      // Notice was er al niet of method bestaat niet — niet kritisch.
    }
  },
};

/**
 * Wacht tot `window.Didomi` beschikbaar is, of geef op na timeout.
 *
 * Gebruikt `didomiOnReady` als die er al is (efficiëntst), valt
 * anders terug op een poll-loop. Sommige Didomi-installaties
 * gebruiken alleen `window.Didomi` zonder de ready-array.
 */
function waitForDidomi(): Promise<DidomiApi | null> {
  return new Promise((resolve) => {
    if (window.Didomi) {
      resolve(window.Didomi);
      return;
    }

    if (Array.isArray(window.didomiOnReady)) {
      window.didomiOnReady.push((didomi) => resolve(didomi));
      // Backup: als didomiOnReady is gedefinieerd maar nooit fired,
      // val terug op timeout-poll hieronder.
    }

    const start = Date.now();
    const intervalId = window.setInterval(() => {
      if (window.Didomi) {
        window.clearInterval(intervalId);
        resolve(window.Didomi);
        return;
      }
      if (Date.now() - start >= LOAD_TIMEOUT_MS) {
        window.clearInterval(intervalId);
        resolve(null);
      }
    }, POLL_INTERVAL_MS);
  });
}
