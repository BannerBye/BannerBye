/**
 * Vindt de "weigeren"-knop in de DOM, inclusief Shadow DOMs.
 *
 * Twee-staps strategie:
 *
 *   PASS 1 — STRICT match
 *   Loop door alle klikbare elementen in document + shadow-DOMs +
 *   same-origin iframes. Match button-tekst exact tegen REJECT_KEYWORDS.
 *   Eerste match wint. Lage false-positive risico — keywords zijn
 *   specifiek genoeg ("Alle weigeren", "Decline all", etc.).
 *
 *   PASS 2 — AMBIGUOUS match met banner-context
 *   Voor sites met generieke knop-teksten ("Opslaan" / "Save" zonder
 *   context). Match alleen als de knop binnen een fixed/sticky/absolute
 *   container zit waarvan de tekst cookie-gerelateerde woorden bevat.
 *   Voorkomt dat we per ongeluk een form-Save klikken.
 *
 * Voorbeeld waar PASS 2 nodig is: MediaMarkt heeft alleen "Opslaan" +
 * "Alles accepteren". "Opslaan" slaat de default-OFF selectie op =
 * effectief weigeren, maar het woord alleen is te generiek voor PASS 1.
 */

import {
  isRejectText,
  isAmbiguousRejectText,
  isStepIntoText,
  hasCookieContext,
} from './keywords.ts';

/** CSS-selector voor alle plausibel-klikbare elementen. */
const CLICKABLE_SELECTOR = [
  'button',
  '[role="button"]',
  'a[href]',
  'input[type="button"]',
  'input[type="submit"]',
].join(',');

/** Hoeveel parents we omhoog walken om een banner-container te vinden. */
const MAX_PARENT_DEPTH = 15;

/**
 * Zoekt de eerste zichtbare reject-knop in de huidige DOM (incl. shadow).
 * Eerst strict pass, dan ambiguous-met-context pass.
 *
 * @param relaxContext  Als true: ambigue keywords matchen zonder container-
 *   context-check. Gebruik dit ná een step-into klik — we weten dan al dat
 *   we in cookie-flow zitten, en het detail-paneel is vaak een full-page
 *   replacement (geen fixed overlay meer).
 *
 * Snel — stopt bij eerste match. Geen banner = null in <5ms.
 */
export function findRejectButton(relaxContext = false): HTMLElement | null {
  // We verzamelen alle zichtbare clickable kandidaten één keer en gebruiken
  // de array voor beide passes. Voorkomt dat we de DOM 2x walken.
  const candidates: Array<{ el: HTMLElement; text: string }> = [];
  for (const el of walkClickables(document)) {
    if (!isVisible(el)) continue;
    const text = el.innerText || el.textContent || '';
    if (!text.trim()) continue;
    candidates.push({ el, text });
  }

  // PASS 1: strict matches (current high-confidence behavior)
  for (const { el, text } of candidates) {
    if (isRejectText(text)) return el;
  }

  // PASS 2: ambiguous matches.
  // - Default: alleen binnen een fixed/sticky cookie-banner-container
  // - relaxContext: skip de container-check, matchen overal
  for (const { el, text } of candidates) {
    if (!isAmbiguousRejectText(text)) continue;
    if (relaxContext || isInCookieBanner(el)) return el;
  }

  return null;
}

/**
 * Zoekt een step-into knop ("Meer opties", "Manage settings", etc.) —
 * leidt naar een tweede-stap-paneel waar gebruiker normaal expliciete
 * keuzes maakt. Alleen returnen als de knop binnen een cookie-banner zit,
 * anders matched 'ie op willekeurige "Settings"/"Voorkeuren"-links elders.
 *
 * Wordt door de orchestrator alleen aangeroepen als findRejectButton
 * niets vond — dus dit is laatste fallback voor dark-pattern-sites
 * (fok.nl, sommige news-sites) waar reject-actie verstopt zit.
 */
export function findStepIntoButton(): HTMLElement | null {
  for (const el of walkClickables(document)) {
    if (!isVisible(el)) continue;
    const text = el.innerText || el.textContent || '';
    if (!text.trim()) continue;
    if (isStepIntoText(text) && isInCookieBanner(el)) return el;
  }
  return null;
}

/**
 * Lazy generator die alle klikbare elementen yields uit de hele
 * document-tree, inclusief Shadow DOMs en same-origin iframes.
 */
function* walkClickables(root: Document | ShadowRoot): Generator<HTMLElement> {
  for (const el of root.querySelectorAll<HTMLElement>(CLICKABLE_SELECTOR)) {
    yield el;
  }

  for (const host of root.querySelectorAll<HTMLElement>('*')) {
    if (host.shadowRoot) {
      yield* walkClickables(host.shadowRoot);
    }
  }

  if (root === document) {
    for (const frame of document.querySelectorAll<HTMLIFrameElement>('iframe')) {
      try {
        const frameDoc = frame.contentDocument;
        if (frameDoc) {
          yield* walkClickables(frameDoc);
        }
      } catch {
        // Cross-origin frame — geen toegang.
      }
    }
  }
}

/**
 * Returns true als het element zich binnen een cookie-banner bevindt.
 *
 * Heuristiek: walk omhoog door parents tot we een element vinden met
 *   - position: fixed | sticky | absolute (banners zijn typisch overlays)
 *   - en wiens textContent een cookie-context-woord bevat
 *
 * Dit is conservatief — voorkomt dat we een random "Save"-knop op een
 * formulier klikken alleen omdat de pagina-footer "cookies" zegt.
 */
function isInCookieBanner(el: HTMLElement): boolean {
  let current: HTMLElement | null = el;
  let depth = 0;

  while (current && depth < MAX_PARENT_DEPTH) {
    const style = window.getComputedStyle(current);
    const isOverlay =
      style.position === 'fixed' ||
      style.position === 'sticky' ||
      style.position === 'absolute';

    if (isOverlay) {
      const text = current.innerText || current.textContent || '';
      // Container moet niet té klein zijn (excludes tooltips etc.) en
      // niet té groot (excludes <body> dat toevallig "cookie" bevat).
      const rect = current.getBoundingClientRect();
      const reasonablySized =
        rect.width >= 200 &&
        rect.height >= 80 &&
        rect.width <= window.innerWidth * 1.1;

      if (reasonablySized && hasCookieContext(text)) {
        return true;
      }
    }

    // Walk ook door shadow-host-grenzen heen — als we in een shadow
    // root zijn, ga naar de host element van die root.
    const parentEl: HTMLElement | null = current.parentElement;
    if (!parentEl) {
      const root = current.getRootNode();
      if (root instanceof ShadowRoot) {
        current = root.host as HTMLElement;
      } else {
        current = null;
      }
    } else {
      current = parentEl;
    }
    depth++;
  }

  return false;
}

/**
 * Checkt of een element daadwerkelijk zichtbaar is voor de gebruiker.
 */
function isVisible(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;

  const style = window.getComputedStyle(el);
  if (style.display === 'none') return false;
  if (style.visibility === 'hidden') return false;
  if (style.opacity === '0') return false;

  return true;
}
