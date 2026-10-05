/**
 * BannerBye — structurele bannerherkenning (v0.4.8, bouwpunt 7 uit het
 * productonderzoek van 5 oktober 2026).
 *
 * Tot nu toe zei `isInCookieBanner()` (laag 5) én de Phase 2B-detector "ja"
 * tegen élke gepositioneerde container waarvan de tekst over cookies gaat.
 * Op het Duitse duckduckgo.com — een site die adverteert met het blokkeren
 * van cookie-pop-ups — was dat genoeg om het zijmenu voor een banner aan te
 * zien (#310), en de pijplijn maakte dezelfde fout. Dit raakt elke site die
 * over privacy schrijft: browsers, VPN's, privacyblogs, toezichthouders.
 *
 * Een echte cookiebanner heeft bijna altijd minstens twee van deze vijf
 * structurele kenmerken; een zijmenu met een link heeft er hooguit één:
 *
 *   dialog     role="dialog"/"alertdialog", aria-modal, of een <dialog>
 *   overlay    bedekt een flink deel van de viewport als balk of modal
 *              (geen smalle, hoge zijbalk)
 *   topZ       z-index die boven de pagina uitsteekt
 *   cmpHint    id/class uit de CMP-wereld (cookie, consent, onetrust, …)
 *   actionPair een accepteer-knop én een weiger-/instellingen-knop in
 *              hetzelfde element
 *
 * `bannerStructureSignals()` is bewust zelfstandig (geen imports, alleen
 * DOM-API's) zodat exact dezelfde functie via `page.evaluate` in de
 * Phase 2B-detector draait — één bron van waarheid voor "is dit een banner".
 */

export const BANNER_STRUCTURE_MIN_SIGNALS = 2;

export type BannerStructureSignal = 'dialog' | 'overlay' | 'topZ' | 'cmpHint' | 'actionPair';

/**
 * Geeft de structurele signalen van een (vermoedelijke) bannercontainer.
 * Zelfstandig houden: dit wordt ook geserialiseerd naar de browser.
 */
export function bannerStructureSignals(el: Element): BannerStructureSignal[] {
  const signals: BannerStructureSignal[] = [];
  const h = el as HTMLElement;
  const view = (el.ownerDocument && el.ownerDocument.defaultView) || window;

  // dialog
  const role = (el.getAttribute('role') || '').toLowerCase();
  const ariaModal = (el.getAttribute('aria-modal') || '').toLowerCase() === 'true';
  const innerDialog =
    role === 'dialog' || role === 'alertdialog' || ariaModal || el.tagName === 'DIALOG'
      ? true
      : !!el.querySelector('[role="dialog"],[role="alertdialog"],[aria-modal="true"],dialog');
  if (innerDialog) signals.push('dialog');

  // overlay — balk (volle breedte, beperkte hoogte) of modal (groot blok),
  // maar géén smalle hoge zijbalk zoals een navigatiemenu.
  try {
    const rect = h.getBoundingClientRect();
    const vw = Math.max(1, view.innerWidth);
    const vh = Math.max(1, view.innerHeight);
    const widthFrac = rect.width / vw;
    const heightFrac = rect.height / vh;
    const areaFrac = widthFrac * heightFrac;
    const isSidebar = widthFrac < 0.5 && heightFrac > 0.6;
    const isBar = widthFrac >= 0.6 && heightFrac <= 0.45;
    const isModal = areaFrac >= 0.12 && widthFrac >= 0.3;
    if (!isSidebar && (isBar || isModal)) signals.push('overlay');
  } catch {
    // Geen layout (bv. detached) — geen overlay-signaal.
  }

  // topZ
  try {
    const z = parseInt(view.getComputedStyle(h).zIndex || '0', 10);
    if (Number.isFinite(z) && z >= 100) signals.push('topZ');
  } catch {
    // Niet kritiek.
  }

  // cmpHint — op het element zelf of één niveau dieper (veel CMP's wikkelen
  // hun banner in een anonieme fixed wrapper).
  const CMP_HINT =
    /cookie|consent|cmp|gdpr|privacy[-_]?(banner|notice|bar|wall)|onetrust|cookiebot|usercentrics|didomi|sp_message|qc-cmp|klaro|osano|truste|trustarc|cc-banner|cc-window|iubenda|complianz|borlabs|tarteaucitron|axeptio|cookieyes|termly/i;
  const idClass = (node: Element): string =>
    `${node.id || ''} ${typeof node.className === 'string' ? node.className : ''} ${node.getAttribute('data-testid') || ''}`;
  let hint = CMP_HINT.test(idClass(el));
  if (!hint) {
    const kids = el.children;
    for (let i = 0; i < kids.length && i < 12 && !hint; i++) {
      const kid = kids[i];
      if (kid) hint = CMP_HINT.test(idClass(kid));
    }
  }
  if (hint) signals.push('cmpHint');

  // actionPair — een accepteer-achtige én een weiger-/instellingen-achtige
  // knop in dezelfde container. Een menu met alleen "Einstellungen" haalt
  // dit niet; een consent-or-pay-banner (accepteren + instellingen) wel.
  const ACCEPT =
    /accept|agree|allow|akkoord|accepteer|toestaan|zustimm|akzeptier|einverstanden|accepter|autoriser|aceptar|permitir|accetta|consenti|aceitar|zgadzam|godkänn|accepter|hyväksy|συμφων|αποδοχ|ok\b|got it|prima/i;
  const REFUSE_OR_MANAGE =
    /reject|decline|refuse|deny|disagree|weiger|afwijz|ablehn|verweiger|refuser|rechazar|rifiut|recus|odrzuć|avvis|hylkää|απορρ|necessary|essential|noodzakelij|notwendig|nécessaire|manage|settings|preferen|customi|instellingen|einstellungen|paramètres|configur|aanpassen|anpassen|options|more/i;
  const clickables = el.querySelectorAll(
    'button, a[href], [role="button"], input[type="button"], input[type="submit"]',
  );
  let hasAccept = false;
  let hasRefuse = false;
  for (let i = 0; i < clickables.length && i < 40; i++) {
    const c = clickables[i] as HTMLElement;
    const t = (
      c.innerText ||
      c.textContent ||
      (c as HTMLInputElement).value ||
      c.getAttribute('aria-label') ||
      ''
    )
      .replace(/\s+/g, ' ')
      .trim();
    if (!t || t.length > 160) continue;
    if (!hasAccept && ACCEPT.test(t)) hasAccept = true;
    else if (!hasRefuse && REFUSE_OR_MANAGE.test(t)) hasRefuse = true;
    if (hasAccept && hasRefuse) break;
  }
  if (hasAccept && hasRefuse) signals.push('actionPair');

  return signals;
}

/** Structureel genoeg om het een banner te noemen (naast de tekstcontext). */
export function looksStructurallyLikeBanner(el: Element): boolean {
  return bannerStructureSignals(el).length >= BANNER_STRUCTURE_MIN_SIGNALS;
}
