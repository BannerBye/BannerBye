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

/** Draaien we in een sub-frame (dus niet het hoofdvenster)? */
export function isSubFrame(): boolean {
  try {
    return window.top !== window.self;
  } catch {
    // Toegang tot window.top gooit bij cross-origin — dan zitten we in een frame.
    return true;
  }
}

/**
 * Mag deze frame verwerkt worden?
 *
 * Hoofdframe: altijd ja. Sub-frame: alleen als de URL van een bekend
 * consent-platform is, óf als het document zichtbaar over cookies gaat.
 * Zo blijven advertentie- en video-iframes onaangeraakt.
 */
export function shouldProcessFrame(): boolean {
  if (!isSubFrame()) return true;

  try {
    const href = location.href.toLowerCase();
    if (CONSENT_FRAME_HOSTS.some((host) => href.includes(host))) return true;

    // Fallback voor zelfgebouwde consent-iframes op een eigen subdomein:
    // een klein document dat expliciet over cookies/toestemming gaat.
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
