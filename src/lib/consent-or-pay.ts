/**
 * Consent-or-pay-muren (het "PUR"-model).
 *
 * Sommige uitgevers bieden geen weigerknop meer. De keuze is: alles
 * accepteren, óf een abonnement kopen. bild.de is het aanleidingsgeval
 * (report 2026-08-20): BILD's eigen FAQ zegt letterlijk dat het instellen
 * van consents is afgeschaft sinds ze BILD Pur introduceerden.
 *
 * BannerBye raakt zulke muren met opzet niet aan:
 *  - klikken zou "accepteren" betekenen — het tegenovergestelde van wat we doen;
 *  - verbergen zou neerkomen op het omzeilen van een betaalmuur.
 *
 * Dit bestand houdt bij wélke hosts dat betreft, zodat de andere lagen zich
 * kunnen inhouden en de popup het aan de gebruiker kan uitleggen. Zonder die
 * uitleg ziet een gebruiker alleen een banner die blijft staan en meldt 'm
 * als kapot — precies wat er bij bild.de gebeurde.
 *
 * De lijst is bewust KORT en alleen geverifieerde gevallen. Een host hier ten
 * onrechte in zetten betekent dat BannerBye een site loslaat waar wél gewoon
 * geweigerd kan worden. Groeien doet de lijst via `consentOrPay` in
 * rules.json — dat gaat zonder store-release.
 */

import { normalizeHost } from './host.ts';

/**
 * Gebundelde, geverifieerde consent-or-pay-hosts.
 *
 * - bild.de — BILD Pur, geverifieerd via BILD's eigen FAQ (2026-08-20).
 * - ad.nl / telegraaf.nl — bekend accept-or-pay, staat als zodanig in de
 *   projectkennis; blijft zichtbaar per bestaande afspraak.
 *
 * Alleen uitbreiden na verificatie dat er écht geen gratis weigeroptie is.
 */
export const BUNDLED_CONSENT_OR_PAY_HOSTS: readonly string[] = [
  'bild.de',
  'ad.nl',
  'telegraaf.nl',
];

/** Extra hosts uit rules.json. Leeg tot `setRemoteConsentOrPayHosts` draait. */
let remoteHosts: string[] = [];

/**
 * Vul de remote lijst aan vanuit rules.json. Ongeldige entries vallen af.
 * Idempotent — elke aanroep vervangt de vorige lijst.
 */
export function setRemoteConsentOrPayHosts(hosts: string[] | undefined): void {
  if (!hosts) return;
  remoteHosts = hosts
    .map((h) => normalizeHost(h))
    .filter((h): h is string => h !== null);
}

/** Exact, of een subdomein ervan (`m.bild.de` hoort bij `bild.de`). */
function matchesEntry(host: string, entry: string): boolean {
  return host === entry || host.endsWith(`.${entry}`);
}

/**
 * Staat deze host bekend als consent-or-pay? Werkt op zowel een hostname
 * als een volledige URL.
 */
export function isConsentOrPayHost(input: string): boolean {
  const host = normalizeHost(input);
  if (!host) return false;
  for (const entry of BUNDLED_CONSENT_OR_PAY_HOSTS) {
    if (matchesEntry(host, entry)) return true;
  }
  for (const entry of remoteHosts) {
    if (matchesEntry(host, entry)) return true;
  }
  return false;
}
