/**
 * Multi-language list van knop-teksten die "weiger consent" betekenen.
 *
 * Gebruikt door de auto-click-fallback om de juiste knop te vinden
 * op sites die geen TCF/CMP gebruiken (custom consent-UIs).
 *
 * **Strenge match-regel:** we matchen alleen op EXACTE tekst (na
 * normalisatie: lowercase, trim, multi-space → single-space). Dit
 * voorkomt dat we per ongeluk een "Accept"-knop klikken die toevallig
 * "reject"-letters bevat. Beter veilig dan banners onbedoeld accepteren.
 *
 * Talen ondersteund: NL, EN, DE, FR, ES, IT (de grote EU-markten).
 * Voor specifieke fouten: voeg toe aan deze lijst, niet in detection-code.
 */

export const REJECT_KEYWORDS: readonly string[] = [
  // === English ===
  'reject all',
  'reject all cookies',
  'reject',
  'decline all',
  'decline all cookies',
  'decline',
  'deny all',
  'deny',
  'refuse all',
  'refuse',
  'do not accept',
  "don't accept",
  'necessary only',
  'only necessary',
  'essential only',
  'only essential',
  'use necessary cookies only',
  'use essential cookies only',
  // v0.4.0 (#170-test): typeless.com toont "Reject non-essential cookies".
  // PASS 1 is een exacte match, dus de losse variant 'reject' hielp hier niet.
  'reject non-essential cookies',
  'reject non-essential',
  'reject non essential cookies',
  'reject optional cookies',
  'decline optional cookies',
  'reject unnecessary cookies',
  'continue without accepting',
  'continue without consent',
  // v0.1.5: courtesy-style decline-knoppen die we eerder gemist hebben.
  'no thanks',
  'no thank you',

  // === Nederlands ===
  'weigeren',
  'alles weigeren',
  'alle weigeren',
  'cookies weigeren',
  'afwijzen',
  'alles afwijzen',
  'alleen noodzakelijke',
  'alleen noodzakelijke cookies',
  'alleen functionele',
  'alleen functionele cookies',
  'alleen essentiële',
  'alleen essentiële cookies',
  // v0.3.5 (#168): varianten zónder buigings-e. Lieferando/Thuisbezorgd
  // (Just Eat Takeaway) gebruikt letterlijk "Alleen noodzakelijk" — die viel
  // eerder buiten de exacte match en liet de banner staan.
  'alleen noodzakelijk',
  'alleen functioneel',
  'alleen essentieel',
  'alleen technisch noodzakelijk',
  'alleen technisch noodzakelijke cookies',
  'doorgaan zonder accepteren',
  'verder zonder accepteren',
  // v0.1.5: "Nee dank je"-varianten zoals op sabineboogaard.nl waar de
  // banner niet werd weggeklikt door v0.1.x. Beleefde refuse-tekst is in
  // Nederlandse e-commerce een veel voorkomend patroon naast het strakke
  // "Weigeren".
  'nee dank je',
  'nee, dank je',
  'nee bedankt',
  'nee, bedankt',
  'nee dank u',
  'nee, dank u',
  'nee dankje',
  'nee, dankje',

  // === Deutsch ===
  'ablehnen',
  'alle ablehnen',
  'alles ablehnen',
  'cookies ablehnen',
  'nicht akzeptieren',
  'nur erforderliche',
  'nur erforderliche cookies',
  'nur notwendige',
  'nur notwendige cookies',
  // v0.4.0 (#170-test): event-buddy.de toont "Nur Essenzielle" — die variant
  // ontbrak, waardoor de banner bleef staan. Beide spellingen meenemen.
  'nur essenzielle',
  'nur essenzielle cookies',
  'nur essentielle',
  'nur essentielle cookies',
  'nur technisch notwendige',
  'nur technisch notwendige cookies',
  'essenzielle cookies',
  'weiter ohne zustimmung',
  // v0.1.5: courtesy-decline.
  'nein danke',

  // === Français ===
  'refuser',
  'tout refuser',
  'refuser tout',
  'refuser tous',
  'refuser tous les cookies',
  'continuer sans accepter',
  'uniquement essentiels',
  'uniquement nécessaires',

  // === Español ===
  'rechazar',
  'rechazar todo',
  'rechazar todas',
  'rechazar todas las cookies',
  'sólo necesarias',
  'solo necesarias',
  'continuar sin aceptar',

  // === Italiano ===
  'rifiuta',
  'rifiuta tutto',
  'rifiuta tutti',
  'solo necessari',
  'continua senza accettare',
];

/**
 * **Zins-fragmenten** die een weiger-actie aankondigen binnen een langere
 * knoptekst (PASS 1.5).
 *
 * Aanleiding (#refurbishedstore.de, 2026-08-14): sommige custom banners
 * zetten de weiger-actie niet op een knop met het woord "Ablehnen", maar op
 * een hele zin:
 *
 *   "Sie möchten diese Cookies nicht akzeptieren? Dann können Sie diese
 *    hier ablehnen."
 *
 * De exact-match van PASS 1 mist die per definitie. Substring-matching op
 * losse woorden ("reject") is te riskant, daarom matchen we op fragmenten
 * die alléén in een weiger-formulering voorkomen — en dan nog uitsluitend:
 *   - binnen een cookie-banner-container (isInCookieBanner), én
 *   - op een écht knop-achtig element (geen link die wegnavigeert), én
 *   - op teksten korter dan MAX_PHRASE_TEXT_LENGTH (een knop, geen alinea).
 *
 * Zie finder.ts PASS 1.5 voor die vangrails.
 */
export const REJECT_PHRASES: readonly string[] = [
  // === Nederlands ===
  'hier weigeren',
  'ze hier weigeren',
  'hier afwijzen',
  'niet accepteren?',
  'hier weigeren.',
  // === Deutsch ===
  'hier ablehnen',
  'diese hier ablehnen',
  'nicht akzeptieren?',
  // === English ===
  'refuse them here',
  'reject them here',
  'decline them here',
  'reject them below',
  // === Français ===
  'les refuser ici',
  'refuser ici',
  // === Español ===
  'rechazarlas aquí',
  'rechazarlos aquí',
  // === Italiano ===
  'rifiutarli qui',
  'rifiutarle qui',
];

/**
 * **Ambigue** reject-keywords — woorden die OOK een weiger-actie kunnen
 * betekenen, maar in andere contexten gewone form-acties zijn.
 *
 * "Opslaan" / "Save" alleen klikken zou false positives geven op contact-
 * formulieren, instellingenpagina's, etc. Daarom gebruiken we deze lijst
 * alléén in combinatie met `isInCookieBanner()` — context-aware match.
 *
 * Voorbeeld: MediaMarkt's banner heeft alleen "Opslaan" + "Alles accepteren".
 * "Opslaan" slaat de default-OFF selectie op = effectief weigeren.
 */
export const AMBIGUOUS_REJECT_KEYWORDS: readonly string[] = [
  // Nederlands
  'opslaan',
  'opslaan + sluiten',
  'opslaan en sluiten',
  'opslaan & sluiten',
  'voorkeuren opslaan',
  'instellingen opslaan',
  'selectie opslaan',
  'keuzes opslaan',
  'mijn keuzes opslaan',
  'mijn keuze opslaan',
  'instellingen bewaren',
  'bevestigen',
  'bevestig keuze',
  'bevestig mijn keuze',
  'bevestigen + sluiten',
  'bevestigen en sluiten',
  // English
  'save',
  'save and close',
  'save & close',
  'save + close',
  'save preferences',
  'save settings',
  'save selection',
  'save my choices',
  'save my preferences',
  'save my selection',
  'confirm',
  'confirm choices',
  'confirm and close',
  'confirm my choices',
  'confirm my selection',
  // Deutsch
  'speichern',
  'einstellungen speichern',
  'auswahl speichern',
  // Français
  'enregistrer',
  'enregistrer mes choix',
  // Español
  'guardar',
  'guardar preferencias',
  // Italiano
  'salva',
  'salva preferenze',
];

/**
 * Knoppen die naar een tweede-stap-paneel leiden waar we daadwerkelijk
 * kunnen weigeren. Sites met dark patterns (zoals fok.nl) verstoppen
 * de reject-actie achter een "Meer opties"-knop in plaats van 'm
 * direct in de banner te zetten.
 *
 * Strategie bij geen direct match: klik step-into → wacht op nieuwe
 * paneel-state → run normale finder opnieuw, vind nu de save/reject-knop
 * (vermoedelijk via AMBIGUOUS_REJECT_KEYWORDS + banner-context).
 *
 * Net als ambigue keywords: alleen klikken in cookie-context, anders
 * krijg je false positives op "Settings" / "Preferences" links elders.
 */
export const STEP_INTO_KEYWORDS: readonly string[] = [
  // Nederlands
  'meer opties',
  'voorkeuren instellen',
  'cookie-instellingen',
  'cookie instellingen',
  'instellingen aanpassen',
  'aanpassen',
  'beheren',
  'meer details',
  // English
  'more options',
  'manage settings',
  'manage preferences',
  'manage options',
  'manage cookies',
  'cookie settings',
  'cookie preferences',
  'customize',
  'customise',
  'show purposes',
  'show details',
  'show preferences',
  // Deutsch
  'mehr optionen',
  'einstellungen',
  'einstellungen anpassen',
  'individuelle einstellungen',
  'cookie-einstellungen',
  // Français
  "plus d'options",
  'paramètres',
  'paramètres des cookies',
  'personnaliser',
  'gérer mes choix',
  // Italiano
  'più opzioni',
  'impostazioni cookie',
  'personalizza',
];

/**
 * Context-woorden die wijzen op een cookie-banner.
 *
 * Als een element binnen een `position:fixed/sticky` container zit
 * waarvan de tekst één van deze woorden bevat, dan classificeren we
 * 'm als "in een cookie-banner" — en mogen we ambigue keywords klikken.
 */
export const COOKIE_CONTEXT_WORDS: readonly string[] = [
  'cookie',
  'cookies',
  'consent',
  'privacy',
  'toestemming',
  'voorkeur',
  'voorkeuren',
  'gdpr',
  'avg',
  'datenschutz',
  'confidentialité',
];

/**
 * Runtime-extensies vanuit remote rule-set (zie src/lib/rules/).
 *
 * Bundled keywords blijven de baseline; remote keywords worden additief
 * gemerged. Dit laat ons nieuwe site-varianten ondersteunen zonder
 * Chrome Web Store-release.
 *
 * Set door `setRemoteKeywords()` aan het begin van een content-script
 * draaien. Default leeg.
 */
let remoteRejectKeywords: string[] = [];
let remoteAmbiguousKeywords: string[] = [];
let remoteStepIntoKeywords: string[] = [];
let remoteRejectPhrases: string[] = [];

/**
 * Injecteer remote keywords. Roep aan vanuit content scripts ná het lezen
 * van de gecachde rules uit chrome.storage.local.
 *
 * Inputs worden genormaliseerd (lowercase + whitespace) en gefilterd op
 * non-empty strings.
 */
export function setRemoteKeywords(rules: {
  rejectKeywords?: string[];
  ambiguousKeywords?: string[];
  stepIntoKeywords?: string[];
  rejectPhrases?: string[];
}): void {
  remoteRejectPhrases = (rules.rejectPhrases ?? [])
    .map(normalize)
    .filter((s) => s.length > 0);
  remoteRejectKeywords = (rules.rejectKeywords ?? [])
    .map(normalize)
    .filter((s) => s.length > 0);
  remoteAmbiguousKeywords = (rules.ambiguousKeywords ?? [])
    .map(normalize)
    .filter((s) => s.length > 0);
  remoteStepIntoKeywords = (rules.stepIntoKeywords ?? [])
    .map(normalize)
    .filter((s) => s.length > 0);
}

/**
 * Normaliseert een tekst voor matching.
 * - lowercase
 * - trim whitespace aan begin/eind
 * - multi-space → single space
 * - verwijdert non-breaking spaces, tabs, newlines
 */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Returns true als de genormaliseerde tekst exact één van de
 * STRICT reject-keywords is. Geen substring-match — te veel false positives.
 *
 * Checkt zowel bundled als remote keywords (set via setRemoteKeywords).
 */
export function isRejectText(text: string): boolean {
  const normalized = normalize(text);
  if (!normalized) return false;
  return (
    REJECT_KEYWORDS.includes(normalized) ||
    remoteRejectKeywords.includes(normalized)
  );
}

/**
 * Returns true als de (genormaliseerde) tekst één van de REJECT_PHRASES
 * bevat — substring-match, bedoeld voor knoppen waarvan de tekst een hele
 * zin is. Caller MOET zelf de vangrails uit finder.ts PASS 1.5 toepassen
 * (knop-achtig element, geen navigerende link, lengtelimiet, banner-context).
 */
export function containsRejectPhrase(text: string): boolean {
  const normalized = normalize(text);
  if (!normalized) return false;
  return (
    REJECT_PHRASES.some((phrase) => normalized.includes(phrase)) ||
    remoteRejectPhrases.some((phrase) => normalized.includes(phrase))
  );
}

/**
 * Returns true als de tekst exact één van de AMBIGUE reject-keywords is.
 * Caller moet dan zelf nog `isInCookieBanner()` checken voor we klikken.
 */
export function isAmbiguousRejectText(text: string): boolean {
  const normalized = normalize(text);
  if (!normalized) return false;
  return (
    AMBIGUOUS_REJECT_KEYWORDS.includes(normalized) ||
    remoteAmbiguousKeywords.includes(normalized)
  );
}

/**
 * Returns true als de tekst exact één van de step-into keywords is.
 * Caller checkt zelf nog `isInCookieBanner()` — net als ambiguous.
 */
export function isStepIntoText(text: string): boolean {
  const normalized = normalize(text);
  if (!normalized) return false;
  return (
    STEP_INTO_KEYWORDS.includes(normalized) ||
    remoteStepIntoKeywords.includes(normalized)
  );
}

/**
 * Returns true als de gegeven tekst minstens één cookie-context-woord
 * bevat (substring-match, case-insensitive).
 */
export function hasCookieContext(text: string): boolean {
  const lower = text.toLowerCase();
  return COOKIE_CONTEXT_WORDS.some((word) => lower.includes(word));
}
