/**
 * Auto-click fallback orchestrator.
 *
 * Aanroepen vanuit een content script. Deze module:
 *   1. Probeert direct een reject-knop te vinden (strict + ambiguous-met-context)
 *   2. Als die er niet is: probeert een step-into knop ("Meer opties" etc.)
 *      te klikken om een detail-paneel te openen, dan opnieuw te zoeken
 *      (dekt dark-pattern sites zoals fok.nl)
 *   3. Zet MutationObserver op de DOM voor banners die later renderen
 *   4. Stopt na een timeout (default 10s)
 *
 * Maximaal één klik-actie per "type" per page-load:
 *  - één step-into klik (idempotent)
 *  - één reject-klik (idempotent, beëindigt de flow)
 *
 * Voorkomt dat we per ongeluk meerdere knoppen klikken op een pagina,
 * en blokkeert oneindige loops als step-into geen bruikbaar paneel opent.
 */

import { findRejectButton, findStepIntoButton } from './finder.ts';

/** Hoe lang we proberen voordat we opgeven. */
const OBSERVE_TIMEOUT_MS = 10_000;

/** Throttle voor MutationObserver — niet bij elke DOM-mutatie zoeken. */
const SCAN_THROTTLE_MS = 150;

/** Vertraging na step-into klik voordat we opnieuw scannen — geeft de
 * banner-UI tijd om het detail-paneel te renderen. */
const STEP_INTO_DELAY_MS = 500;

/** Wachttijd ná een weiger-klik voordat we verifiëren of de banner echt weg is. */
const VERIFY_DELAY_MS = 600;

export interface AutoClickResult {
  clicked: boolean;
  /**
   * True als de banner ná de weiger-klik ook echt verdwenen is (geverifieerd).
   * False = geklikt maar de banner staat er nog (klik werkte niet).
   */
  verified?: boolean;
  /** Tekst van de geklikte reject-knop, voor logging/debug. */
  buttonText?: string;
  /** True als we via step-into de reject-knop bereikten. */
  viaStepInto?: boolean;
  /** Hoe lang het duurde voor we 'm vonden (ms na start). */
  elapsedMs: number;
}

/**
 * Is de banner ná een weiger-klik nog echt aanwezig? Bewust onafhankelijk van
 * onze eigen prehide (die `opacity:0` gebruikt): we checken op verwijderd/
 * verborgen via DOM-connectie, display/visibility en grootte — NIET op opacity.
 * Een echte CMP-dismissal verwijdert de banner of zet 'm op display:none.
 */
function bannerStillPresent(el: Element): boolean {
  if (!el.isConnected) return false;
  try {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
  } catch {
    return false;
  }
  const r = el.getBoundingClientRect();
  return r.width > 0 || r.height > 0;
}

/**
 * Start de auto-click fallback. Geeft een Promise terug die resolved
 * zodra de knop is geklikt of de timeout is verstreken.
 */
export function startAutoClick(
  options: { timeoutMs?: number } = {},
): Promise<AutoClickResult> {
  const timeoutMs = options.timeoutMs ?? OBSERVE_TIMEOUT_MS;
  const startTime = Date.now();

  return new Promise((resolve) => {
    let resolved = false;
    let verifying = false;
    let stepIntoClicked = false;
    let throttleTimeoutId = 0;
    let pendingScan = false;

    const finish = (result: AutoClickResult): void => {
      if (resolved) return;
      resolved = true;
      observer?.disconnect();
      window.clearTimeout(timeoutId);
      window.clearTimeout(throttleTimeoutId);
      resolve(result);
    };

    /**
     * Eén poging: vind reject-knop direct, of probeer step-into als
     * we die nog niet eerder hebben geprobeerd.
     */
    const tryClick = (): void => {
      if (resolved || verifying) return;
      // Autoconsent-laag (Fase 1) handelt bekende CMP's zelf af. Zolang die
      // actief is of al klaar is, laat de generieke laag deze pagina met rust
      // (voorkomt dubbel klikken/tellen). Flags staan op de gedeelde window.
      const w = window as Window;
      if (w.__bbConsentHandled || w.__bbConsentActive) return;

      // PASS 1+2: directe reject-knop. Na een step-into klik passen we
      // de relax-flag toe — we zitten dan al in een cookie-flow, en het
      // detail-paneel is vaak een full-page replacement zonder fixed
      // overlay meer (zoals fok.nl's "Keuze aanpassen"-paneel).
      const reject = findRejectButton(stepIntoClicked);
      if (reject) {
        const buttonText = (reject.innerText || reject.textContent || '').trim();
        try {
          reject.click();
        } catch (err) {
          console.warn('[BannerBye] reject click failed:', err);
          return; // klik faalde → blijf proberen
        }
        // Geklikt. Verifieer ná een korte delay of de banner écht weg is,
        // i.p.v. blind aannemen dat de klik werkte. `verifying` blokkeert
        // ondertussen nieuwe klik-pogingen; finish() ruimt observer/timeouts op.
        verifying = true;
        const viaStepInto = stepIntoClicked;
        window.setTimeout(() => {
          finish({
            clicked: true,
            verified: !bannerStillPresent(reject),
            buttonText,
            viaStepInto,
            elapsedMs: Date.now() - startTime,
          });
        }, VERIFY_DELAY_MS);
        return;
      }

      // PASS 3: step-into (eenmalig per page-load)
      if (stepIntoClicked) return;
      const stepInto = findStepIntoButton();
      if (!stepInto) return;

      stepIntoClicked = true;
      try {
        stepInto.click();
        // De click triggert DOM-mutaties die de observer pickt — maar we
        // schedulen ook een expliciete delayed scan als backup, voor het
        // geval het detail-paneel via CSS-transition komt zonder DOM-change.
        window.setTimeout(scheduleScan, STEP_INTO_DELAY_MS);
      } catch (err) {
        console.warn('[BannerBye] step-into click failed:', err);
      }
    };

    /** Throttled scan-trigger voor de MutationObserver. */
    const scheduleScan = (): void => {
      if (pendingScan || resolved) return;
      pendingScan = true;
      throttleTimeoutId = window.setTimeout(() => {
        pendingScan = false;
        tryClick();
      }, SCAN_THROTTLE_MS);
    };

    // Direct proberen — knop kan al aanwezig zijn op document_idle.
    tryClick();
    if (resolved || verifying) return;

    const observer = new MutationObserver(scheduleScan);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    // Geef het op na timeoutMs.
    const timeoutId = window.setTimeout(() => {
      finish({ clicked: false, elapsedMs: Date.now() - startTime });
    }, timeoutMs);
  });
}
