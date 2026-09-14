/**
 * Vindt de "weigeren"-knop in de DOM, inclusief Shadow DOMs.
 *
 * Vier-staps strategie, van hoogste naar laagste vertrouwen:
 *
 *   PASS 1 — STRICT tekst-match
 *   Loop door alle klikbare elementen in document + shadow-DOMs +
 *   same-origin iframes. Match button-tekst exact tegen REJECT_KEYWORDS.
 *   Eerste match wint. Lage false-positive risico — keywords zijn
 *   specifiek genoeg ("Alle weigeren", "Decline all", etc.). Taalafhankelijk
 *   (moet de zichtbare taal kennen).
 *
 *   PASS ATTR — taalonafhankelijke id/class/data-*-match (v0.4.4)
 *   Matcht op attributen i.p.v. zichtbare tekst — CMP's coderen hun knoppen
 *   bijna altijd in het Engels, ongeacht de gelokaliseerde zichtbare tekst.
 *   Werkt daardoor voor élke taal tegelijk, en vangt ook icon-only knoppen
 *   zonder leesbaar label. Zie isRejectAttributeHint() in keywords.ts.
 *
 *   PASS 1.5 — zin-fragment-match binnen banner-context
 *   Voor knoppen met een hele zin als label i.p.v. een los woord.
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
 *
 * Laatste redmiddel (buiten deze functie, zie translate.ts): als geen van
 * deze vier passes iets vindt, probeert de orchestrator (index.ts) ná de
 * timeout nog een on-device vertaling van de knoptekst naar het Engels.
 */

import {
  isRejectText,
  isAmbiguousRejectText,
  isStepIntoText,
  containsRejectPhrase,
  hasCookieContext,
  isRejectAttributeHint,
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
 * Maximale tekstlengte voor een PASS 1.5 zin-match. Een weiger-knop met een
 * hele zin erop is lang (~80 tekens), een alinea met een reject-woord erin is
 * veel langer. Deze grens houdt PASS 1.5 op knoppen en niet op tekstblokken.
 */
const MAX_PHRASE_TEXT_LENGTH = 160;

/**
 * Maximale lengte van een label dat we van een shadow-host overnemen.
 * Een knoplabel is kort; is de host-tekst langer, dan is het waarschijnlijk
 * een container en geen knop — dan liever niets dan een verkeerde match.
 */
const MAX_HOST_LABEL_LENGTH = 60;

/**
 * Leest de zichtbare tekst van een klikbaar element.
 *
 * v0.3.5 (#168): design systems op basis van web-componenten — Just Eat's
 * PIE (lieferando.de, thuisbezorgd.nl), maar ook Lit/Stencil-gebaseerde
 * bibliotheken in het algemeen — renderen een echte <button> ín hun shadow
 * root en zetten het label via een <slot> uit de light DOM. De shadow-button
 * heeft dan lege innerText én textContent, terwijl de host (<pie-button>) de
 * zichtbare tekst draagt. Zonder deze fallback ziet de matcher een knop
 * zonder tekst, matcht geen enkel keyword, en blijft de banner staan.
 *
 * Volgorde: eigen tekst → aria-label → tekst van de dichtstbijzijnde
 * custom-element-host. We klikken bewust nog steeds op de shadow-button
 * zelf, want dáár hangt de event-handler.
 */
function readLabel(el: HTMLElement): string {
  const own = (el.innerText || el.textContent || '').trim();
  if (own) return own;

  const aria = (el.getAttribute('aria-label') || '').trim();
  if (aria) return aria;

  let root: Node = el.getRootNode();
  let depth = 0;
  while (root instanceof ShadowRoot && depth < 3) {
    const host = root.host as HTMLElement | null;
    if (!host) break;
    // Alleen custom elements (tagnaam met koppelteken) — een gewone <div>
    // als shadow-host zegt niets over een knoplabel.
    if (host.tagName.includes('-')) {
      const hostText = (host.innerText || host.textContent || '').trim();
      if (hostText && hostText.length <= MAX_HOST_LABEL_LENGTH) return hostText;
      const hostAria = (host.getAttribute('aria-label') || '').trim();
      if (hostAria) return hostAria;
    }
    root = host.getRootNode();
    depth++;
  }

  return '';
}

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
  // de array voor alle passes. Voorkomt dat we de DOM meermaals walken.
  // `visibleEls` bevat ALLE zichtbare klikbare elementen (ook zonder
  // leesbare tekst — icon-only knoppen); `candidates` is het subset mét
  // tekst, voor de tekst-gebaseerde passes.
  const visibleEls: HTMLElement[] = [];
  const candidates: Array<{ el: HTMLElement; text: string }> = [];
  for (const el of walkClickables(document)) {
    if (!isVisible(el)) continue;
    visibleEls.push(el);
    const text = readLabel(el);
    if (text) candidates.push({ el, text });
  }

  // PASS 1: strict matches (current high-confidence behavior)
  for (const { el, text } of candidates) {
    if (isRejectText(text)) return el;
  }

  // PASS ATTR: taalonafhankelijke id/class/data-*-hints (v0.4.4).
  // CMP's coderen hun knoppen bijna altijd in het Engels, ook met een
  // gelokaliseerde zichtbare tekst (coffeeisland.gr's "Cookie Control":
  // `.ccc-reject-button` met Griekse knoptekst) — dus dit matcht voor élke
  // taal tegelijk, en vangt ook icon-only knoppen zonder leesbaar label.
  // Zie isRejectAttributeHint() in keywords.ts voor de match-logica.
  for (const el of visibleEls) {
    if (!isSafeToClick(el)) continue;
    const { tokens, raw } = readAttributeTokens(el);
    if (isRejectAttributeHint(tokens, raw)) return el;
  }

  // PASS 1.5: zin-matches ("... können Sie diese hier ablehnen.").
  // Alleen op knop-achtige elementen binnen een cookie-banner, en met een
  // lengtelimiet — zie REJECT_PHRASES in keywords.ts voor de motivatie.
  for (const { el, text } of candidates) {
    if (text.length > MAX_PHRASE_TEXT_LENGTH) continue;
    if (!containsRejectPhrase(text)) continue;
    if (!isSafeToClick(el)) continue;
    if (relaxContext || isInCookieBanner(el)) return el;
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
 * Verzamelt alle zichtbare klikbare elementen mét leesbare tekst — zelfde
 * DOM-walk als `findRejectButton()`'s tekst-candidates, maar als losse
 * export zodat andere modules (translate.ts) 'm kunnen hergebruiken zonder
 * de walk-logica te dupliceren.
 */
export function collectVisibleTextCandidates(): Array<{ el: HTMLElement; text: string }> {
  const candidates: Array<{ el: HTMLElement; text: string }> = [];
  for (const el of walkClickables(document)) {
    if (!isVisible(el)) continue;
    const text = readLabel(el);
    if (text) candidates.push({ el, text });
  }
  return candidates;
}

/**
 * Attributen die we naast id/class doorzoeken op taalonafhankelijke hints.
 * Gangbare test-/CMP-attributen bij verschillende design systems.
 */
const ATTRIBUTE_HINT_SOURCES = [
  'data-testid',
  'data-test',
  'data-cy',
  'data-qa',
  'data-action',
  'data-role',
  'data-purpose',
  'data-type',
  'data-cookieconsent',
  'data-consent',
];

/**
 * Verzamelt id/class/relevante data-*-attributen van een element, en
 * splitst ze op kebab-case/camelCase/snake_case-grenzen tot losse lowercase
 * tokens — plus de ruwe samengevoegde lowercase-string voor de
 * compact-hint-substring-check. Taalonafhankelijke tegenhanger van
 * readLabel(): CMP's coderen hun knoppen bijna altijd in het Engels, ook
 * bij gelokaliseerde zichtbare tekst (zie isRejectAttributeHint()).
 */
function readAttributeTokens(el: HTMLElement): { tokens: string[]; raw: string } {
  const parts: string[] = [];
  if (el.id) parts.push(el.id);
  // SVG-elementen hebben className als SVGAnimatedString, geen string —
  // die negeren we hier (SVG's zijn zelden de klikbare banner-knop zelf).
  const className = typeof el.className === 'string' ? el.className : '';
  if (className) parts.push(className);
  for (const attr of ATTRIBUTE_HINT_SOURCES) {
    const val = el.getAttribute(attr);
    if (val) parts.push(val);
  }

  const combined = parts.join(' ');
  const raw = combined.toLowerCase();

  const tokens = combined
    // camelCase-grenzen eerst markeren (vóór lowercase, anders verdwijnt
    // het hoofdletter-signaal dat de grens aangeeft).
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    // kebab-case/snake_case/overige scheidingstekens → spatie
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean);

  return { tokens, raw };
}

/**
 * Vangrail voor PASS ATTR en PASS 1.5: alleen klikken op elementen die écht
 * een knop zijn. Een zin als "Cookies kun je hier weigeren", of een element
 * met een reject-achtige class, kan op sommige sites een gewone link naar
 * de cookie-instellingenpagina zijn. Die klikken zou de gebruiker
 * wegnavigeren van de pagina waar hij is — erger dan een banner laten staan.
 * Anchors mogen dus alleen als ze nergens heen gaan (`#`, leeg, javascript:).
 */
function isSafeToClick(el: HTMLElement): boolean {
  const tag = el.tagName;
  if (tag === 'BUTTON') return true;
  if (tag === 'INPUT') return true;
  if (el.getAttribute('role') === 'button') return true;

  if (tag === 'A') {
    const href = (el.getAttribute('href') ?? '').trim();
    return href === '' || href === '#' || href.toLowerCase().startsWith('javascript:');
  }

  return false;
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
    const text = readLabel(el);
    if (!text) continue;
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
