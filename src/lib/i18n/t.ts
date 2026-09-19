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
export function t(key: string, substitutions?: string | string[]): string {
  try {
    const msg = chrome.i18n.getMessage(key, substitutions);
    return msg || key;
  } catch {
    return key;
  }
}
