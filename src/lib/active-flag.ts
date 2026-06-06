/**
 * BannerBye — active-flag bridge (v0.2.0)
 *
 * Het probleem dat dit oplost: TCF/CMP/GPC content scripts draaien in
 * MAIN world, waar `chrome.storage` niet beschikbaar is. Tot v0.1.x hadden
 * we daardoor géén manier om die scripts daadwerkelijk uit te schakelen
 * bij toggle-off of per-site pause. De DNR-rule werd wel uitgezet, maar
 * de JS-injecties (__tcfapi, navigator.globalPrivacyControl, euconsent-v2
 * cookie) bleven gewoon draaien. Pijnlijk debugbaar gedrag, gebroken
 * product-promise.
 *
 * Oplossing: window-flag bridge. Background script injecteert vóór onze
 * MAIN-world scripts een tiny inline-script via chrome.scripting.executeScript
 * met injectImmediately:true. Dat script zet `window.__bannerbyeState` op
 * de huidige state. Onze MAIN content scripts checken die flag aan het
 * begin van main() en doen early-return als state !== 'active'.
 *
 * Voordelen:
 *  - Cross-browser werkt (Chrome MV3 + Firefox MV2 + Safari MV2 met fallback)
 *  - Geen runtime-unregister van manifest-scripts nodig (wat MV2 niet kan)
 *  - Geen architectuur-overhaul — alleen een early-return per script
 *  - Settings-changes propageren via background listener + re-injectie
 *
 * Limitaties:
 *  - Bestaande `euconsent-v2` cookies blijven plakken na toggle-off
 *    (vereist chrome.cookies permission — pas in v0.3.0 toegevoegd)
 *  - `navigator.globalPrivacyControl` met `configurable:false` kan niet
 *    ongedaan gemaakt worden op dezelfde pagina-load — pas na reload
 *
 * Zie /04. Output/BannerBye/v0.1.5-architecture.md voor het volledige plan.
 */

import { isHostPaused, normalizeHost } from './host.ts';
import { getSettings } from './storage.ts';

/**
 * State die de bridge naar MAIN-world scripts communiceert.
 *  - 'active'   → alle interventies aan
 *  - 'disabled' → globale toggle uit, geen enkele interventie
 *  - 'paused'   → globaal aan, maar deze host gepauzeerd door user
 */
export type ActiveState = 'active' | 'disabled' | 'paused';

/**
 * Property-naam op window die de inline-script zet. Bewust een lange,
 * onderscheidende naam om collisions met page-scripts te voorkomen.
 *
 * MAIN content scripts lezen deze global property direct uit. Geen
 * andere extensies of page-scripts mogen hem zetten (zou een security-
 * issue zijn, maar omdat we 'm via executeScript injecteren zit hij
 * vóór page-scripts in document_start).
 */
export const ACTIVE_FLAG_KEY = '__bannerbyeState';

/**
 * Type-augmentatie zodat TypeScript de flag op window kent.
 */
declare global {
  interface Window {
    [ACTIVE_FLAG_KEY]?: ActiveState;
  }
}

/**
 * Bereken de active-state voor een hostname op basis van current settings.
 *
 * - Settings.enabled === false → 'disabled' (toggle uit, niets doen)
 * - Hostname in pausedSites    → 'paused'   (alleen GPC-header doorlaten)
 * - Anders                     → 'active'
 *
 * Wordt aangeroepen door background bij elke navigation event.
 */
export async function computeStateForHost(hostname: string | null): Promise<ActiveState> {
  const settings = await getSettings();
  if (!settings.enabled) return 'disabled';
  if (!hostname) return 'active';
  return isHostPaused(hostname, settings.pausedSites) ? 'paused' : 'active';
}

/**
 * Inline-functie die door background.ts via chrome.scripting.executeScript
 * (of browser.tabs.executeScript op MV2) in de MAIN-world wordt geïnjecteerd.
 *
 * BELANGRIJK: deze functie wordt geserialized en in de page context uitgevoerd.
 * Heeft GEEN toegang tot import-symbolen uit dit bestand. Alleen wat als
 * argument meegegeven wordt (`state`) en globals van de page (window).
 *
 * Houd 'm dus zo simpel mogelijk en zelfstandig.
 */
export function inlineSetFlag(state: ActiveState, flagKey: string): void {
  // Aanname: deze runt in page-context (MAIN world). `window` is hier
  // het page-window, niet de extension-context.
  try {
    (window as unknown as Record<string, ActiveState>)[flagKey] = state;
  } catch {
    // Sommige strict-mode of frozen-window contexts kunnen 't blokkeren.
    // Niet kritiek — content scripts treat afwezige flag als 'active'
    // (= fallback naar v0.1.x-gedrag).
  }
}

/**
 * Helper voor content scripts: lees de flag uit window.
 *
 * Returns 'active' als de flag niet gezet is — pure backward-compat:
 * als het bridge-mechanisme zou falen, blijft BannerBye in elk geval
 * werken zoals voorheen (geen silent-disable).
 */
export function readActiveState(): ActiveState {
  try {
    const state = window[ACTIVE_FLAG_KEY];
    if (state === 'disabled' || state === 'paused' || state === 'active') {
      return state;
    }
  } catch {
    // window-toegang faalt — onmogelijk maar safety net.
  }
  return 'active';
}
