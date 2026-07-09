/**
 * Autoconsent-laag (concurrentie-pariteit — Fase 1).
 *
 * Draait de DuckDuckGo Autoconsent-engine (MPL-2.0) met 776 declaratieve
 * CMP-regels als extra laag tussen TCF en de generieke auto-click. Handelt
 * bekende Consent Management Providers deterministisch af met meerstaps
 * opt-out + eigen prehide + self-test.
 *
 * ⚠️ NB: deze laag draait op elke pagina en coördineert async met de generieke
 * auto-click. Hij staat standaard UIT (zie AUTOCONSENT_LAYER_ENABLED in
 * autoconsent.content.ts) tot 'ie in een dev-build in een echte browser is
 * getest. Veilig te mergen; pas live zetten na verificatie.
 *
 * Coördinatie met de generieke auto-click gebeurt via twee vlaggen op de
 * gedeelde ISOLATED-world `window`:
 *   __bbConsentActive  — een bekende CMP wordt nu verwerkt → autoclick wacht
 *   __bbConsentHandled — CMP is afgehandeld → autoclick slaat over
 *
 * v1-beperking: geen MAIN-world eval-bridge. ~5% van de regels gebruikt een
 * `eval`-actie; die beantwoorden we met `false` (degradeert netjes). De overige
 * ~95% werkt op DOM-clicks. Eval-bridge kan later als vervolg.
 */

import AutoConsent from '@duckduckgo/autoconsent';
import type { Config, RuleBundle } from '@duckduckgo/autoconsent';
import rules from '@duckduckgo/autoconsent/rules/rules.json';

declare global {
  interface Window {
    __bbConsentActive?: boolean;
    __bbConsentHandled?: boolean;
  }
}

/**
 * Start de Autoconsent-laag. `onHandled` wordt één keer aangeroepen zodra een
 * bekende CMP succesvol is geweigerd (voor de teller + badge).
 */
export function startAutoconsentLayer(onHandled: () => void): void {
  const config: Partial<Config> = {
    enabled: true,
    autoAction: 'optOut',
    // Ethos: géén cosmetisch verbergen via filterlijsten als default.
    enableCosmeticRules: false,
    // Autoconsent doet z'n eigen prehide voor de CMP's die het kent.
    enablePrehide: true,
    isMainWorld: false,
    logs: {
      lifecycle: false,
      rulesteps: false,
      detectionsteps: false,
      evals: false,
      errors: false,
      messages: false,
      waits: false,
    },
  };

  let handledFired = false;
  const markHandled = (): void => {
    if (handledFired) return;
    handledFired = true;
    window.__bbConsentHandled = true;
    try {
      onHandled();
    } catch {
      // teller-callback mag nooit de laag breken
    }
  };

  const consent = new AutoConsent(
    async (msg) => {
      switch (msg.type) {
        case 'eval':
          // Geen MAIN-world eval in v1 → antwoord false; regel neemt de
          // else-tak of slaat de stap over.
          await consent.receiveMessageCallback({
            type: 'evalResp',
            id: msg.id,
            result: false,
          });
          break;
        case 'cmpDetected':
          // Bekende CMP herkend → de generieke auto-click moet even wachten.
          window.__bbConsentActive = true;
          break;
        case 'optOutResult':
          if (msg.result) markHandled();
          break;
        case 'autoconsentDone':
          // Klaar. Niets afgehandeld → laat de fallback-laag weer los.
          if (!handledFired) window.__bbConsentActive = false;
          break;
        default:
          break;
      }
    },
    config,
    rules as unknown as RuleBundle,
  );

  try {
    consent.start();
  } catch {
    window.__bbConsentActive = false;
  }
}
