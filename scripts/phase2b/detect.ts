/**
 * Phase 2B — in-page detectie.
 *
 * `detectInPage` draait BINNEN de browser via page.evaluate. Daarom:
 *   - geen imports, geen closures over buiten-variabelen
 *   - alleen DOM/window-API's
 *   - alles wat het teruggeeft moet serialiseerbaar zijn (plain JSON)
 *
 * Het levert ruwe signalen op; de classificatie (in Node) beslist wat ze
 * betekenen, zodat we daar de échte extensie-keyword-logica kunnen hergebruiken.
 */

export interface ClickCandidate {
  /** Zichtbare tekst van het klikbare element (ongenormaliseerd). */
  text: string;
  /** Tagnaam, bv. 'button' / 'a'. */
  tag: string;
}

export interface DetectionResult {
  finalUrl: string;
  /** Herkende CMP-namen (bv. 'OneTrust', 'Cookiebot'). */
  cmps: string[];
  /** IAB TCF aanwezig (window.__tcfapi). */
  hasTcf: boolean;
  /** Is er een zichtbare consent-banner gevonden? */
  bannerVisible: boolean;
  /** Klikbare elementen binnen de (vermoedelijke) banner. */
  candidates: ClickCandidate[];
  /** Korte snippet van de banner-tekst (max 300 tekens), voor de PR-body. */
  bannerTextSnippet: string;
}

/**
 * Wordt geserialiseerd naar de browser. Houd 'm volledig self-contained.
 */
export function detectInPage(): DetectionResult {
  const COOKIE_WORDS = [
    'cookie',
    'consent',
    'privacy',
    'gdpr',
    'tracking',
    'we use',
    'wij gebruiken',
    'toestemming',
    'datenschutz',
    'einwilligung',
    'vie privée',
    'confidentialité',
    'privacidad',
  ];

  function isVisible(el: Element): boolean {
    const style = window.getComputedStyle(el as HTMLElement);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      parseFloat(style.opacity || '1') < 0.05
    ) {
      return false;
    }
    const rect = (el as HTMLElement).getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function textOf(el: Element): string {
    return (el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  // --- 1. CMP-detectie via globals + bekende container-selectors ---
  const w = window as unknown as Record<string, unknown>;
  const cmps: string[] = [];
  const sig: Array<[string, boolean]> = [
    ['OneTrust', !!w['OneTrust'] || !!document.getElementById('onetrust-banner-sdk')],
    ['Cookiebot', !!w['Cookiebot'] || !!document.getElementById('CybotCookiebotDialog')],
    ['Usercentrics', !!w['UC_UI'] || !!document.getElementById('usercentrics-root')],
    ['Didomi', !!w['Didomi'] || !!document.getElementById('didomi-host')],
    ['Quantcast', !!document.querySelector('.qc-cmp2-container, #qc-cmp2-container')],
    ['Klaro', !!w['klaro'] || !!document.querySelector('.klaro')],
    ['CookieScript', !!w['CookieScript'] || !!document.getElementById('cookiescript_injected')],
    ['TrustArc', !!document.getElementById('truste-consent-track')],
    ['Osano', !!document.querySelector('.osano-cm-window')],
    ['Sourcepoint', !!document.querySelector('[id^="sp_message_container"]')],
  ];
  sig.forEach(([name, present]) => {
    if (present) cmps.push(name);
  });

  const hasTcf = typeof w['__tcfapi'] === 'function';

  // --- 2. Vind de consent-banner ---
  // Strategie: pak zichtbare containers (fixed/sticky of hoge z-index) die
  // cookie-context-woorden bevatten en niet de hele pagina beslaan.
  let banner: Element | null = null;
  const containers = Array.from(
    document.querySelectorAll('div, section, aside, dialog, form'),
  );
  let best = -1;
  for (const el of containers) {
    if (!isVisible(el)) continue;
    const txt = textOf(el).toLowerCase();
    if (!txt || txt.length > 1500) continue;
    if (!COOKIE_WORDS.some((wd) => txt.includes(wd))) continue;
    const style = window.getComputedStyle(el as HTMLElement);
    const z = parseInt(style.zIndex || '0', 10) || 0;
    const fixed = style.position === 'fixed' || style.position === 'sticky';
    // Score: fixed/sticky + hoge z-index + korte tekst = waarschijnlijker banner.
    const score = (fixed ? 1000 : 0) + Math.min(z, 100000) / 100 + (1500 - txt.length) / 100;
    if (score > best) {
      best = score;
      banner = el;
    }
  }

  const bannerVisible = banner !== null;

  // --- 3. Klikbare elementen binnen de banner verzamelen ---
  const candidates: ClickCandidate[] = [];
  const seen = new Set<string>();
  const scope: ParentNode = banner ?? document;
  const clickables = Array.from(
    scope.querySelectorAll(
      'button, a[href], [role="button"], input[type="button"], input[type="submit"]',
    ),
  );
  for (const el of clickables) {
    if (!isVisible(el)) continue;
    let text = textOf(el);
    if (!text) {
      const val = (el as HTMLInputElement).value;
      const aria = el.getAttribute('aria-label');
      text = (val || aria || '').replace(/\s+/g, ' ').trim();
    }
    if (!text || text.length > 60) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ text, tag: el.tagName.toLowerCase() });
  }

  const bannerTextSnippet = banner ? textOf(banner).slice(0, 300) : '';

  return {
    finalUrl: location.href,
    cmps,
    hasTcf,
    bannerVisible,
    candidates,
    bannerTextSnippet,
  };
}
