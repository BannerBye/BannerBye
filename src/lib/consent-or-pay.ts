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
 * ⚠️ Sinds v0.3.7 draaien de content scripts óók in sub-frames (frame-guard).
 * Binnen zo'n frame is `location.hostname` het domein van de CMP-leverancier
 * (bijv. `privacy-mgmt.com` van Sourcepoint), NIET de site waar de gebruiker
 * is. Toetsen op de eigen hostname zou de muur daar dus niet herkennen en de
 * auto-click alsnog in bild.de's toestemmingsvenster laten klikken. Gebruik
 * daarom `isConsentOrPayContext()`, dat naar de bovenliggende pagina kijkt.
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
 *
 * Let op: dit toetst precies wat je meegeeft. Vanuit een content script hoor
 * je `isConsentOrPayContext()` te gebruiken — zie de toelichting bovenaan.
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

/**
 * Host van de pagina die de gebruiker daadwerkelijk bezoekt — ook wanneer we
 * in een cross-origin consent-iframe draaien.
 *
 * Volgorde:
 *  1. Hoofdframe → gewoon onze eigen hostname.
 *  2. `location.ancestorOrigins` (Chrome/Safari): de laatste entry is het
 *     bovenste frame. Werkt óók cross-origin, want het is alleen de origin.
 *  3. `document.referrer` als benadering — Firefox kent ancestorOrigins niet.
 *     Bij een consent-iframe is de referrer in de praktijk de insluitende
 *     pagina.
 *
 * Geeft null als niets van dit alles lukt; callers moeten dat behandelen als
 * "onbekend", niet als "geen betaalmuur".
 */
export function getTopHost(): string | null {
  try {
    if (window.top === window.self) {
      return normalizeHost(location.hostname);
    }
  } catch {
    // Toegang tot window.top gooit cross-origin — we zitten dus in een frame.
  }

  try {
    const origins = location.ancestorOrigins;
    if (origins && origins.length > 0) {
      const top = origins[origins.length - 1];
      if (top) {
        const host = normalizeHost(top);
        if (host) return host;
      }
    }
  } catch {
    // ancestorOrigins bestaat niet in Firefox — val terug op de referrer.
  }

  try {
    if (document.referrer) {
      const host = normalizeHost(document.referrer);
      if (host) return host;
    }
  } catch {
    // niets meer om op terug te vallen
  }

  return null;
}

/**
 * Draaien we — direct of als frame binnen — op een consent-or-pay-site?
 *
 * Dit is de check die content scripts horen te gebruiken. Hij kijkt naar de
 * bovenliggende pagina, zodat de beveiliging ook geldt binnen het iframe van
 * de CMP-leverancier.
 */
export function isConsentOrPayContext(): boolean {
  const top = getTopHost();
  if (top && isConsentOrPayHost(top)) return true;
  // Vangnet: het hoofdframe zelf (en het zeldzame geval dat getTopHost faalt
  // maar onze eigen host al bekend is).
  return isConsentOrPayHost(location.hostname);
}
