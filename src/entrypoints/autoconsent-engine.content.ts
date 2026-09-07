/**
 * BannerBye — Autoconsent-motor (laag 3), on-demand geïnjecteerd.
 *
 * v0.4.2 (#212, 7 sep 2026). Dit bestand bevat de DuckDuckGo
 * Autoconsent-engine plus de volledige regelbundel (~800 KB gebouwd). Het
 * wordt NIET via het manifest op pagina's geladen: `matches` wijst naar een
 * URL die nooit bestaat (dezelfde truc als tcf/cmp/gpc op Chrome), zodat WXT
 * het wél bouwt — als `content-scripts/autoconsent-engine.js`, binnen de
 * folder-reference die de Safari-wrapper automatisch meeneemt (SKILL.md §7)
 * — maar de browser het nergens zelf injecteert.
 *
 * De poortwachter (autoconsent.content.ts, een paar KB, draait in elk frame)
 * beslist of dit frame een consent-frame kan zijn en vraagt dan de background
 * om precies dit bestand in precies dat frame te injecteren
 * (`bb:autoconsent-inject` → chrome.scripting.executeScript met frameId).
 * Zo betaalt alleen een frame dat de motor echt nodig heeft de parse- en
 * geheugenkosten van de regelbundel — in plaats van élk advertentie-iframe.
 *
 * ISOLATED world, net als de poortwachter en de generieke auto-click, zodat
 * de coördinatievlaggen (__bbConsentActive / __bbConsentHandled) op dezelfde
 * window leven.
 */

import { defineContentScript } from 'wxt/sandbox';
import { AUTOCONSENT_LAYER_ENABLED } from '@/lib/feature-flags.ts';
import { startAutoconsentLayer } from '@/lib/autoclick/autoconsent-layer.ts';

declare global {
  interface Window {
    /** Dubbele injectie (bijv. twee snelle poortwachter-berichten) afvangen. */
    __bbAutoconsentEngine?: boolean;
  }
}

export default defineContentScript({
  // Nooit-matchende URL: de browser injecteert dit script zelf nergens.
  matches: ['https://_bb_runtime_only_.invalid/*'],
  runAt: 'document_start',
  allFrames: true,

  main() {
    if (!AUTOCONSENT_LAYER_ENABLED) return;
    if (window.__bbAutoconsentEngine) return;
    window.__bbAutoconsentEngine = true;

    startAutoconsentLayer(() => {
      // Bekende CMP geweigerd → tel mee als een geblokkeerde banner (background
      // is single source of truth voor de teller/badge/milestones).
      try {
        void chrome.runtime.sendMessage({
          type: 'bb:banner-blocked',
          platform: 'Known platform',
        });
      } catch {
        // background kan net idle zijn — niet kritiek.
      }
    });
  },
});
