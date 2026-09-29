/**
 * BannerBye — i18n-helper (vertaalronde 19-09-2026).
 *
 * Dunne wrapper om `chrome.i18n.getMessage()`. Bestaat om drie redenen:
 *  1. Eén importpad in plaats van overal `chrome.i18n.getMessage(...)`.
 *  2. Fail-safe: `chrome.i18n.getMessage()` geeft een lege string terug bij
 *     een onbekende sleutel (bv. typefout, of een nieuwe taal die de sleutel
 *     nog niet heeft) — dat zou een lege knop/tekst opleveren. Hier valt dat
 *     terug op de sleutel zelf, zodat een ontbrekende vertaling zichtbaar
 *     blijft in de UI (herkenbaar als bug) in plaats van onzichtbaar leeg.
 *  3. `chrome.i18n` bestaat niet in elke test/preview-context (bv. Vitest
 *     zonder chrome-mock) — de try/catch voorkomt een harde crash daar.
 *
 * Substitutions: chrome.i18n verwacht een string of string[] voor de
 * `$1`/`$2`-placeholders in messages.json. Bij één placeholder mag je een
 * kale string doorgeven; bij meerdere een array in volgorde.
 */
import enMessages from '../../../public/_locales/en/messages.json';

interface MessageEntry {
  message: string;
  placeholders?: Record<string, { content: string }>;
}

/**
 * v0.4.6: Engelse terugval uit de gebundelde bron. De Safari-wrapper bundelt
 * `_locales/` niet mee (SKILL.md §7), dus `chrome.i18n.getMessage()` gaf daar
 * voor élke sleutel een lege string en de popup/onboarding toonden kale
 * sleutels ("popup_status_paused", melding iPadOS 29-09-2026). Nu valt een
 * lege of ontbrekende vertaling eerst terug op het Engels, en pas daarna op
 * de sleutel zelf.
 */
function englishFallback(key: string, substitutions?: string | string[]): string | null {
  const entry = (enMessages as Record<string, MessageEntry>)[key];
  if (!entry || typeof entry.message !== 'string') return null;
  const subs = substitutions === undefined ? [] : Array.isArray(substitutions) ? substitutions : [substitutions];
  const fill = (content: string): string =>
    content.replace(/\$(\d)/g, (_, n: string) => subs[Number(n) - 1] ?? '');
  let out = entry.message.replace(/\$([A-Za-z0-9_@]+)\$/g, (whole, name: string) => {
    const ph = entry.placeholders?.[name.toLowerCase()];
    return ph ? fill(ph.content) : whole;
  });
  out = out.replace(/\$\$/g, '$');
  return out;
}

export function t(key: string, substitutions?: string | string[]): string {
  let msg = '';
  try {
    msg = chrome.i18n.getMessage(key, substitutions);
  } catch {
    // chrome.i18n ontbreekt (test/preview) — val door naar de terugval.
  }
  if (msg) return msg;
  return englishFallback(key, substitutions) ?? key;
}
