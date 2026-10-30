/**
 * Consent-or-pay-muur herkennen (v0.4.11, netzwelt.de-melding 21 okt 2026).
 *
 * Een "pay or okay"-muur biedt twee knoppen: toestemmen (gratis, met
 * tracking) of betalen (abonnement). Er is géén gratis weigerroute, en die
 * mag BannerBye ook niet forceren — zie issue #6 en de popup-tekst
 * `popup_proof_wall`. Tot 0.4.10 werd zo'n muur alleen herkend als hij van
 * Sourcepoint kwam (autoconsent-layer.ts). Alle andere muren — contentpass
 * (netzwelt.de, veel Duitse uitgevers), zelfgebouwde "PUR"-modellen —
 * eindigden als 'clean' in de popup: "niets te weigeren hier", terwijl de
 * gebruiker naar een schermvullende muur keek. Dat leest als een kapotte
 * extensie en levert meldingen op die geen bug zijn.
 *
 * Deze module kijkt alleen; hij klikt nooit. Herkenning is bewust streng:
 *   1. een zichtbare knop met een abonnement/betaal-woord, én
 *   2. een zichtbare knop met een toestem-woord, én
 *   3. géén zichtbare knop die een echte weiger-knop is (dan is het geen
 *      muur maar een gewone banner — laag 5 handelt die af), én
 *   4. cookie-context: in een sub-frame (al gevalideerd als consent-frame
 *      door frame-guard.ts) de frametekst; in het hoofdframe moet de
 *      betaalknop in een structureel herkende banner-container staan.
 *
 * Een abonnementsknop in de sitenavigatie ("Abonnieren" naast het logo)
 * haalt vangrail 4 niet; een paywall zonder toestem-knop haalt 2 niet.
 */

import { collectVisibleTextCandidates, isInCookieBanner } from './finder.ts';
import { hasCookieContext, isRejectText, normalize } from './keywords.ts';
import { isSubFrame } from '../frame-guard.ts';

/** Knoptekst-fragmenten die op betalen/abonneren wijzen. Substring-match. */
export const PAY_WALL_WORDS: readonly string[] = [
  // de
  'abonnieren',
  'abonnement',
  'abo ',
  ' abo',
  'pur-abo',
  'ohne werbung',
  'werbefrei',
  'bezahlen',
  // nl
  'abonneren',
  'zonder advertenties',
  'betalen',
  // en
  'subscribe',
  'subscription',
  'ad-free',
  'ad free',
  'without ads',
  'pay ',
  // fr
  "s'abonner",
  'abonnez',
  'sans publicité',
  // es
  'suscrib',
  'sin publicidad',
  // it
  'abbonati',
  'abbonato',
  'abbonarsi',
  'abbonamento',
  'senza pubblicità',
  // v0.4.14 (ilfattoquotidiano.it, melding 30 okt 2026): "Rifiuta e
  // Sostienici" = weigeren én betalen; "diventa nostro Sostenitore".
  'sostienici',
  'sostenitore',
];

/** Knoptekst-fragmenten die op toestemmen wijzen. Substring-match. */
export const WALL_CONSENT_WORDS: readonly string[] = [
  // de
  'einwilligen',
  'zustimmen',
  'akzeptieren',
  'mit werbung',
  'mit tracking',
  // nl
  'accepteren',
  'akkoord',
  'met advertenties',
  'toestaan',
  // en
  'accept',
  'agree',
  'consent',
  'with ads',
  // fr
  'accepter',
  "j'accepte",
  'avec publicité',
  // es
  'acept',
  'con publicidad',
  // it
  'accett',
  'con pubblicità',
];

/** Een knop is kort; een alinea met het woord "abonnement" erin niet. */
const MAX_BUTTON_TEXT_LENGTH = 80;

function matchesAny(text: string, words: readonly string[]): boolean {
  return words.some((w) => text.includes(w));
}

/**
 * Is er op dit moment een consent-or-pay-muur zichtbaar in dit document?
 * Puur een DOM-check, goedkoop genoeg om bij elke scan te draaien.
 */
export function detectConsentOrPayWall(): boolean {
  let candidates: Array<{ el: HTMLElement; text: string }>;
  try {
    candidates = collectVisibleTextCandidates();
  } catch {
    return false;
  }
  if (candidates.length === 0) return false;

  let payButton: HTMLElement | null = null;
  let consentButton = false;

  for (const { el, text } of candidates) {
    const t = normalize(text);
    if (!t || t.length > MAX_BUTTON_TEXT_LENGTH) continue;
    // Vangrail 3: een echte weigerknop → gewone banner, geen muur.
    if (isRejectText(t)) return false;
    if (!payButton && matchesAny(t, PAY_WALL_WORDS)) payButton = el;
    else if (matchesAny(t, WALL_CONSENT_WORDS)) consentButton = true;
  }
  if (!payButton || !consentButton) return false;

  // Vangrail 4: cookie-context.
  if (isSubFrame()) {
    const text = (document.body?.innerText || '').slice(0, 4000);
    return hasCookieContext(text);
  }
  return isInCookieBanner(payButton);
}
