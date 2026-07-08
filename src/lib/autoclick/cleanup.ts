/**
 * Post-reject opruiming (concurrentie-pariteit met CookieKiller).
 *
 * Sommige consent-banners laten ná het weigeren rommel achter waardoor de
 * pagina onbruikbaar aanvoelt:
 *   - een scroll-lock op <html>/<body> (overflow:hidden, of de position:fixed +
 *     top:-Ypx-truc, of een lock-class als "modal-open");
 *   - een verweesde full-screen overlay/scrim die klikken blokkeert of de
 *     pagina dimt, terwijl de eigenlijke banner-inhoud al weg is.
 *
 * Deze module herstelt scrollen en verwijdert alléén zulke lege wees-overlays.
 *
 * BELANGRIJK (ethos): dit draait UITSLUITEND NÁ een succesvolle weiger-klik —
 * het is opruimen ná het weigeren, NIET "verbergen in plaats van weigeren".
 * Alle checks zijn bewust conservatief zodat we nooit echte pagina-inhoud of
 * een legitieme modal weghalen.
 */

/** Bekende scroll-lock classes die CMP's op <html>/<body> zetten. */
const LOCK_CLASSES = [
  'modal-open', 'modal-active', 'no-scroll', 'noscroll', 'no_scroll',
  'overflow-hidden', 'is-locked', 'scroll-lock', 'scroll-locked', 'body-lock',
  'cmp-active', 'consent-open', 'cookie-open', 'ReactModal__Body--open',
  'stop-scrolling', 'disable-scroll', 'u-noScroll', 'has-modal',
];

/** Herstel scrollen op de document-scroll-container(s). */
function restoreScroll(): void {
  const els = [document.documentElement, document.body];
  for (const el of els) {
    if (!el) continue;

    // 1. Bekende lock-classes weghalen.
    for (const c of LOCK_CLASSES) el.classList.remove(c);

    // 2. Inline scroll-lock-styles wissen.
    const s = el.style;
    if (s.overflow === 'hidden') s.removeProperty('overflow');
    if (s.overflowY === 'hidden') s.removeProperty('overflow-y');
    if (s.position === 'fixed') {
      s.removeProperty('position');
      s.removeProperty('top');
      s.removeProperty('left');
      s.removeProperty('width');
      s.removeProperty('height');
    }

    // 3. Nog steeds hidden ná stap 1+2? Forceer scroll open — maar alléén als
    //    er écht content is om te scrollen (voorkomt breken van full-screen
    //    apps die bewust body-overflow verbergen zonder scroll-content).
    const cs = getComputedStyle(el);
    const locked = cs.overflow === 'hidden' || cs.overflowY === 'hidden';
    const hasScrollableContent = el.scrollHeight > el.clientHeight + 4;
    if (locked && hasScrollableContent) {
      s.setProperty('overflow', 'auto', 'important');
    }
  }
}

/** Ziet dit element eruit als een verweesde, lege full-screen scrim? */
function isOrphanedScrim(el: Element, vw: number, vh: number): boolean {
  const cs = getComputedStyle(el);
  if (cs.position !== 'fixed' && cs.position !== 'absolute') return false;
  if (cs.display === 'none' || cs.visibility === 'hidden') return false;

  const z = parseInt(cs.zIndex || '0', 10) || 0;
  if (z < 1000) return false; // scrims liggen bovenop alles

  const r = (el as HTMLElement).getBoundingClientRect();
  if (r.width < vw * 0.9 || r.height < vh * 0.9) return false; // moet ~heel scherm dekken

  // Echte inhoud? Dan is het geen lege scrim — afblijven.
  const text = (el.textContent || '').trim();
  if (text.length > 5) return false;
  if (el.querySelector('img, video, iframe, form, input, button, a, h1, h2, h3, article')) {
    return false;
  }
  if (el.childElementCount > 3) return false;

  // Moet dimmen (achtergrondkleur) of klikken blokkeren.
  const bg = cs.backgroundColor;
  const dims = !!bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)';
  const blocks = cs.pointerEvents !== 'none';
  return dims || blocks;
}

/** Verwijder verweesde lege full-screen overlays/scrims. */
function removeOrphanedScrims(): void {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const root = document.body;
  if (!root) return;
  const candidates = Array.from(root.querySelectorAll('div, section, aside, span'));
  for (const el of candidates) {
    try {
      if (isOrphanedScrim(el, vw, vh)) el.remove();
    } catch {
      // getComputedStyle/remove kan op edge-cases falen — nooit laten klappen.
    }
  }
}

/**
 * Ruim op ná een succesvolle weiger-klik: herstel scrollen en verwijder
 * verweesde lege overlays. Idempotent en fail-safe.
 */
export function restorePageAfterReject(): void {
  try {
    restoreScroll();
    removeOrphanedScrims();
  } catch {
    // Nooit de pagina laten breken door de opruiming zelf.
  }
}
