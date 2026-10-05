/**
 * @bannerbye/refuse — in-page motor.
 *
 * Dit is dezelfde laag-5-code als in de extensie (src/lib/autoclick):
 * de zoeker naar weiger- en instellingenknoppen, de meertalige sleutel-
 * woorden en de structurele bannercheck. Hier gebundeld als IIFE die
 * `window.__bannerbyeRefuse` zet, zodat een Playwright- of Puppeteer-
 * script er per pagina één stap tegelijk mee kan praten.
 *
 * Geen chrome.*-API's, geen opslag, geen netwerk: alleen DOM.
 */
import { findRejectButton, findStepIntoButton } from '../../../src/lib/autoclick/finder.ts';
import { bannerStructureSignals } from '../../../src/lib/autoclick/banner-structure.ts';
import { hasCookieContext } from '../../../src/lib/autoclick/keywords.ts';

type StepAction = 'reject' | 'stepInto' | 'none';

interface StepResult {
  action: StepAction;
  label: string | null;
  bannerPresent: boolean;
  signals: string[];
}

function label(el: HTMLElement): string {
  return (el.innerText || el.textContent || (el as HTMLInputElement).value || el.getAttribute('aria-label') || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

/**
 * Is er (nog) een cookiebanner zichtbaar? Zelfde definitie als de
 * structurele check in de extensie: gepositioneerd, cookietekst, en
 * minstens twee structurele signalen.
 */
function findBanner(): { el: HTMLElement; signals: string[] } | null {
  const all = document.querySelectorAll<HTMLElement>('div, section, aside, dialog, form, [role="dialog"]');
  for (const el of all) {
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed' && cs.position !== 'sticky' && cs.position !== 'absolute') continue;
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 200 || r.height < 40) continue;
    const text = (el.innerText || '').slice(0, 4000);
    if (text.length < 40 || !hasCookieContext(text)) continue;
    const signals = bannerStructureSignals(el);
    if (signals.length >= 2) return { el, signals };
  }
  return null;
}

let steppedInto = false;

function step(): StepResult {
  const banner = findBanner();
  const reject = findRejectButton(false);
  if (reject) {
    const l = label(reject);
    reject.click();
    return { action: 'reject', label: l, bannerPresent: !!banner, signals: banner?.signals ?? [] };
  }
  if (!steppedInto) {
    const into = findStepIntoButton();
    if (into) {
      steppedInto = true;
      const l = label(into);
      into.click();
      return { action: 'stepInto', label: l, bannerPresent: !!banner, signals: banner?.signals ?? [] };
    }
  }
  return { action: 'none', label: null, bannerPresent: !!banner, signals: banner?.signals ?? [] };
}

function scan(): { bannerPresent: boolean; signals: string[]; rejectLabel: string | null; stepIntoLabel: string | null } {
  const banner = findBanner();
  const reject = findRejectButton(false);
  const into = findStepIntoButton();
  return {
    bannerPresent: !!banner,
    signals: banner?.signals ?? [],
    rejectLabel: reject ? label(reject) : null,
    stepIntoLabel: into ? label(into) : null,
  };
}

declare global {
  interface Window {
    __bannerbyeRefuse?: { step: typeof step; scan: typeof scan; version: string };
  }
}

if (!window.__bannerbyeRefuse) {
  window.__bannerbyeRefuse = { step, scan, version: '0.1.0' };
}
