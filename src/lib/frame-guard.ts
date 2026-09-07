/**
 * BannerBye — frame-guard (v0.3.7, #170)
 *
 * Aanleiding: gebruikersmelding bild.de ("banner kommt immer wieder"). Bild
 * draait Sourcepoint, dat zijn consent-UI in een **cross-origin iframe** zet
 * (cdn.privacy-mgmt.com / sp-prod.net). Onze content scripts stonden op
 * `allFrames: false`, dus ze draaiden alleen in het hoofdframe. De DOM-walker
 * probeert wel iframes te openen, maar `frame.contentDocument` gooit bij
 * cross-origin — die banner was dus principieel onbereikbaar.
 *
 * Bijkomend: 26 van de gebundelde Autoconsent-regels hebben
 * `runContext.frame === true` en `main === false` — die konden nooit vuren.
 *
 * Oplossing: content scripts draaien nu in álle frames, maar in sub-frames
 * doen we eerst een goedkope check of dit überhaupt een consent-frame kán
 * zijn. Zonder die check zou de zware Autoconsent-bundel (776 regels) in elk
 * advertentie-iframe geladen worden — op een nieuwssite tientallen keren.
 */

/**
 * Hosts waarop consent-platforms hun UI in een iframe serveren.
 * Bewust op host-fragmenten gematcht, niet op exacte domeinen: providers
 * gebruiken per klant wisselende subdomeinen.
 */
const CONSENT_FRAME_HOSTS = [
  'privacy-mgmt.com', // Sourcepoint (bild.de, theguardian.com, spiegel.de)
  'sp-prod.net', // Sourcepoint legacy
  'consensu.org', // IAB TCF gedeelde storage
  'cookiebot.com',
  'cookielaw.org', // OneTrust
  'onetrust.com',
  'usercentrics.eu',
  'didomi.io',
  'trustarc.com',
  'consentmanager.net',
  'iubenda.com',
  'osano.com',
  'quantcast.com',
  'privacymanager.io',
  'sourcepoint.mgr.consensu.org',
];

/**
 * Generieke herkenning voor consent-frames op een eigen (sub)domein.
 *
 * v0.3.7 (#173): Duitse uitgevers hosten hun CMP vaak zelf onder namen als
 * `cmp.uitgever.de`, `consent.uitgever.de` of `privacy.uitgever.de` — die
 * staan per definitie niet in een vaste hostlijst. Deze fragmenten vangen dat
 * patroon af. Bewust smal gehouden: het gaat alleen om sub-frames, en een
 * advertentie-iframe heet zelden zo.
 */
const CONSENT_HOST_FRAGMENTS = [
  'consent',
  'cmp.',
  '.cmp',
  'privacy',
  'cookie',
  'gdpr',
  // v0.4.2 (#170, 7 sep): Sourcepoint-klanten hosten de message-iframe vaak
  // op een eigen CNAME met de leveranciersnaam erin — sourcepoint.theguardian.com,
  // spcmp.r53.derstandard.at. Zonder deze fragmenten kwam de Autoconsent-laag
  // daar nooit binnen en bleef de banner staan zodra de CMP eenmaal rendert.
  'sourcepoint',
  'spcmp',
];

/** Draaien we in een sub-frame (dus niet het hoofdvenster)? */
export function isSubFrame(): boolean {
  try {
    return window.top !== window.self;
  } catch {
    // Toegang tot window.top gooit bij cross-origin — dan zitten we in een frame.
    return true;
  }
}

/** Is de URL van dit sub-frame die van een (bekend of zelf-gehost) consent-platform? */
function isConsentFrameByUrl(): boolean {
  try {
    const href = location.href.toLowerCase();
    if (CONSENT_FRAME_HOSTS.some((host) => href.includes(host))) return true;

    // Zelf-gehoste CMP's: kijk alleen naar de hostnaam, niet naar het pad —
    // anders matcht elke URL met "cookie" of "privacy" erin (bijvoorbeeld een
    // link naar een privacyverklaring) en halen we advertentie-iframes binnen.
    const host = location.hostname.toLowerCase();
    if (CONSENT_HOST_FRAGMENTS.some((frag) => host.includes(frag))) return true;

    return isSourcepointFrameUrl();
  } catch {
    return false;
  }
}

/**
 * v0.4.2 (#170, 7 sep): Sourcepoint's message-iframe is aan zijn URL te
 * herkennen, onafhankelijk van de host — spiegel.de serveert 'm bijv. op
 * `sp-spiegel-de.spiegel.de`, zonder leveranciersnaam of 'cmp' in de
 * hostnaam. Zelfde handtekening als de Sourcepoint-regel van Autoconsent
 * zelf gebruikt: `/index.html` (of de privacy-manager-varianten) met een
 * `message_id`-, `consentUUID`- of `requestUUID`-parameter.
 */
export function isSourcepointFrameUrl(): boolean {
  try {
    const params = new URLSearchParams(location.search);
    const spPath = /\/(index|privacy-manager\/index|ccpa_pm\/index|us_pm\/index)\.html$/.test(
      location.pathname,
    );
    return (
      spPath &&
      (params.has('message_id') || params.has('consentUUID') || params.has('requestUUID'))
    );
  } catch {
    return false;
  }
}

/**
 * Fallback voor zelfgebouwde consent-iframes op een eigen subdomein: een
 * klein document dat expliciet over cookies/toestemming gaat. Heeft een
 * gevulde body nodig — op document_start is die er nog niet (zie
 * shouldProcessFrameDeferred).
 */
function isConsentFrameByText(): boolean {
  try {
    const text = (document.body?.innerText || '').slice(0, 2000).toLowerCase();
    if (!text) return false;
    const hasConsentWord =
      text.includes('cookie') ||
      text.includes('consent') ||
      text.includes('zustimmung') ||
      text.includes('einwilligung') ||
      text.includes('toestemming') ||
      text.includes('consentement');
    if (!hasConsentWord) return false;

    // Een consent-frame is compact. Een heel artikel in een iframe met het
    // woord "cookie" erin is dat niet.
    return text.length < 4000;
  } catch {
    return false;
  }
}

/**
 * Mag deze frame verwerkt worden? (synchrone variant)
 *
 * Hoofdframe: altijd ja. Sub-frame: alleen als de URL van een bekend
 * consent-platform is, óf als het document zichtbaar over cookies gaat.
 * Zo blijven advertentie- en video-iframes onaangeraakt.
 */
export function shouldProcessFrame(): boolean {
  if (!isSubFrame()) return true;
  return isConsentFrameByUrl() || isConsentFrameByText();
}

/**
 * Als shouldProcessFrame, maar met een tweede kans voor de tekst-heuristiek.
 *
 * v0.4.2 (#170, 7 sep): de Autoconsent-laag draait op document_start, en op
 * dat moment is `document.body` in een sub-frame nog null — de
 * tekst-fallback gaf dus in de praktijk nooit "ja". Een consent-iframe op een
 * onherkenbare host (geen leveranciersnaam, geen 'cmp'/'consent' in de
 * hostnaam) viel daardoor altijd buiten de boot. Deze variant wacht in dat
 * geval op DOMContentLoaded en beoordeelt dan de tekst alsnog. De kosten zijn
 * verwaarloosbaar: alleen een event-listener in frames die anders toch niets
 * doen; de zware regelbundel wordt pas ná een positief oordeel geladen.
 */
export function shouldProcessFrameDeferred(): Promise<boolean> {
  if (!isSubFrame()) return Promise.resolve(true);
  if (isConsentFrameByUrl()) return Promise.resolve(true);

  // Consent-iframes zijn vrijwel altijd JS-gerenderd: op DOMContentLoaded is
  // de body nog leeg en verschijnt de tekst pas ná een fetch. Daarom niet
  // één keer kijken maar een paar seconden kort pollen (8 × 500 ms). Een
  // advertentie-iframe dat in die tijd tekst krijgt, faalt alsnog op de
  // cookie-woorden- en lengtecheck.
  const POLLS = 8;
  const INTERVAL_MS = 500;
  return new Promise((resolve) => {
    let attempts = 0;
    const poll = (): void => {
      if (isConsentFrameByText()) {
        resolve(true);
        return;
      }
      attempts += 1;
      if (attempts >= POLLS) {
        resolve(false);
        return;
      }
      setTimeout(poll, INTERVAL_MS);
    };
    if (document.readyState !== 'loading') {
      poll();
      return;
    }
    const onReady = (): void => {
      window.removeEventListener('DOMContentLoaded', onReady);
      poll();
    };
    window.addEventListener('DOMContentLoaded', onReady, { once: true });
  });
}
