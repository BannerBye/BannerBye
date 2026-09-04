/**
 * Autoconsent-laag — content-kant (Fase 1, referentie-wiring).
 *
 * We volgen nu de geteste DuckDuckGo-opzet: de content-script maakt een dunne
 * AutoConsent-instantie ZONDER config/regels. AutoConsent stuurt dan zelf een
 * `init`-bericht naar de background; die antwoordt met config + de 776 regels
 * (`initResp`) en draait `eval`-snippets in de MAIN-world van de pagina
 * (`evalResp`). Zonder die background-afhandeling faalde de prehide eerder
 * (`domActions` undefined) — dát was de bug.
 *
 * Coördinatie met de generieke auto-click via window-vlaggen (gedeelde ISOLATED
 * world): `__bbConsentActive` (bekende CMP wordt verwerkt) en
 * `__bbConsentHandled` (afgehandeld → autoclick slaat over).
 */

import AutoConsent from '@duckduckgo/autoconsent';

declare global {
  interface Window {
    __bbConsentActive?: boolean;
    __bbConsentHandled?: boolean;
  }
}

/**
 * Start de content-kant van de Autoconsent-laag. `onHandled` wordt één keer
 * aangeroepen zodra een bekende CMP succesvol is geweigerd (voor teller/badge).
 */
export function startAutoconsentContent(onHandled: () => void): void {
  const consent = new AutoConsent((msg) => {
    // Observeer de uitgaande berichten voor orkestratie + tellen.
    if (msg.type === 'cmpDetected') {
      window.__bbConsentActive = true;
    } else if (msg.type === 'optOutResult') {
      const ok = (msg as { result?: boolean }).result === true;
      if (ok && !window.__bbConsentHandled) {
        window.__bbConsentHandled = true;
        onHandled();
      }
    } else if (msg.type === 'autoconsentDone' && !window.__bbConsentHandled) {
      // Niets afgehandeld → laat de generieke auto-click weer los.
      window.__bbConsentActive = false;
    }
    // Doorsturen naar de background (init/eval/… worden daar afgehandeld).
    try {
      void chrome.runtime.sendMessage(msg);
    } catch {
      // background kan net idle zijn — niet kritiek.
    }
    return Promise.resolve();
  });

  // Antwoorden van de background (initResp/evalResp/optOut/…) aan AutoConsent geven.
  chrome.runtime.onMessage.addListener((message) => {
    void consent.receiveMessageCallback(message);
    return false; // geen sendResponse — background antwoordt via tabs.sendMessage
  });
}
