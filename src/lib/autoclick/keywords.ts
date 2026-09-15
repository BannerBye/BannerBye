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
 * Talen ondersteund in deze tekst-lijst: NL, EN, DE, FR, ES, IT, EL.
 * Voor specifieke fouten: voeg toe aan deze lijst, niet in detection-code.
 *
 * **Sinds v0.4.4 (sep 2026) is dit niet meer de enige taal-strategie.**
 * Woordenlijst per taal opbouwen is per definitie reactief — elke nieuwe
 * taal levert een nieuwe gebruikersmelding op vóór we 'm kunnen fixen.
 * Structurele aanvullingen, in volgorde van taalonafhankelijkheid:
 *
 *   1. `isRejectAttributeHint()` hieronder — matcht op id/class/data-*
 *      (bijna altijd Engels, ook bij gelokaliseerde zichtbare tekst).
 *      Taalonafhankelijk: één check, alle talen tegelijk.
 *   2. `setRemoteKeywords()` — remote keyword-aanvullingen via
 *      bannerbye.com/rules.json (zie src/lib/rules/), geen store-release
 *      nodig. Nieuwe-taal-keywords kunnen hier live binnen uren staan i.p.v.
 *      een release-golf van dagen tot weken.
 *   3. De self-herstellende pijplijn (Phase 2B/2C, bannerbye-landing-repo)
 *      detecteert de paginataal van een gemeld probleem en laat Claude
 *      kandidaat-keywords voorstellen als die taal hier nog ontbreekt —
 *      ter review, vóór ze naar rules.json gepromoveerd worden.
 *   4. `translate.ts` — on-device Translator-API (Chrome/Edge) als laatste
 *      redmiddel voor talen die nergens in 1-3 gedekt zijn.
 *
 * Deze bundled lijst blijft de baseline/fallback als geen van de andere
 * lagen matcht — hem uitbreiden blijft zinvol voor de grootste markten.
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

  // === Ελληνικά (Greek) ===
  // v0.4.3 (14 sep 2026): structurele fix na een gebruikersmelding over
  // coffeeisland.gr. De site draait "Cookie Control" (Civic UK, ccc-prefix
  // in de DOM) — geen van de vijf CMP-handlers uit laag 4 herkent dat, dus
  // het moet via deze generieke laag 5 opgelost worden. De weiger-knop op
  // coffeeisland.gr heet letterlijk "ΔΕ ΣΥΜΦΩΝΩ" — Grieks ontbrak tot dan
  // volledig in deze lijst, dus élke Griekse site liep hierop vast, niet
  // alleen dit ene geval.
  'δε συμφωνώ',
  'δεν συμφωνώ',
  'απόρριψη',
  'απόρριψη όλων',
  'απόρριψη όλων των cookies',
  'απόρριψη cookies',
  'απορρίπτω',
  'απορρίπτω όλα',
  'απορρίψτε όλα',
  'απορρίψτε όλα τα cookies',
  'μόνο απαραίτητα',
  'μόνο τα απαραίτητα',
  'μόνο απαραίτητα cookies',
  'μόνο τα απαραίτητα cookies',
  'απόρριψη μη απαραίτητων cookies',
  'συνέχεια χωρίς αποδοχή',
  'όχι ευχαριστώ',
  // Accentloze varianten: Griekse hoofdletters laten het τόνος (accent)
  // vaak weg — coffeeisland.gr's knop is letterlijk "ΔΕ ΣΥΜΦΩΝΩ" zonder
  // accent op de omega. `.toLowerCase()` voegt dat accent niet terug
  // (bevestigd met een losse test: "ΔΕ ΣΥΜΦΩΝΩ".toLowerCase() geeft
  // "δε συμφωνω", niet "δε συμφωνώ"). Zonder deze regels matcht dus geen
  // enkele Griekse site die z'n knoptekst in hoofdletters zet — in de
  // praktijk de norm voor Griekse UI-knoppen, niet de uitzondering.
  'δε συμφωνω',
  'δεν συμφωνω',
  'απορριψη',
  'απορριψη ολων',
  'απορριψη ολων των cookies',
  'απορριψη cookies',
  'απορριπτω',
  'απορριπτω ολα',
  'απορριψτε ολα',
  'απορριψτε ολα τα cookies',
  'μονο απαραιτητα',
  'μονο τα απαραιτητα',
  'μονο απαραιτητα cookies',
  'μονο τα απαραιτητα cookies',
  'απορριψη μη απαραιτητων cookies',
  'συνεχεια χωρις αποδοχη',
  'οχι ευχαριστω',
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
  // Ελληνικά (v0.4.3, 14 sep 2026 — zie REJECT_KEYWORDS-toelichting)
  'ρυθμίσεις',
  'ρυθμίσεις cookies',
  'διαχείριση προτιμήσεων',
  'διαχείριση cookies',
  'περισσότερες επιλογές',
  'προσαρμογή',
  // accentloze varianten (hoofdletter-knoppen)
  'ρυθμισεις',
  'ρυθμισεις cookies',
  'διαχειριση προτιμησεων',
  'διαχειριση cookies',
  'περισσοτερες επιλογες',
  'προσαρμογη',
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
  // Ελληνικά (v0.4.3, 14 sep 2026)
  'απόρρητο',
  'συγκατάθεση',
  'προτιμήσεις',
  // accentloze varianten
  'απορρητο',
  'συγκαταθεση',
  'προτιμησεις',
];

/**
 * **Taalonafhankelijke** attribuut-hints (id/class/data-*) voor de reject-knop.
 *
 * v0.4.4 (sep 2026, structurele opvolging van de Griekse fix): CMP-vendors
 * programmeren hun knoppen bijna altijd in het Engels, ook als de zichtbare
 * tekst gelokaliseerd is. coffeeisland.gr's "Cookie Control" (Civic UK) zet
 * de weiger-knop op `.ccc-reject-button` terwijl de zichtbare tekst Grieks is
 * ("ΔΕ ΣΥΜΦΩΝΩ"). Een matcher op deze attributen werkt daardoor voor élke
 * taal tegelijk, zonder dat we per taal een woordenlijst hoeven te bouwen —
 * dat is het echte antwoord op "morgen is het Albanië, overmorgen Vietnam".
 *
 * Twee tiers, dezelfde asymmetrie als tekst-matching:
 *
 *   WORD_HINTS — losse tokens, pas gematcht NADAT id/class gesplitst zijn op
 *   kebab-case/camelCase/snake_case-grenzen (zie finder.ts readAttributeTokens).
 *   Bewust kort en generiek genoeg dat elk token exact zo'n woord IS, nooit
 *   een toevallige substring van iets anders.
 *
 *   COMPACT_HINTS — substring-check op de ruwe, ongesplitste attribuutstring.
 *   Vangt CMP's die geen scheidingstekens gebruiken (class="rejectall" zonder
 *   dash/camelCase). Bewust langere, samengestelde fragmenten om een
 *   toevallige match te voorkomen.
 *
 * Bewust NIET opgenomen als los WORD_HINT: "necessary"/"essential" — OneTrust
 * en vergelijkbare CMP's gebruiken id="necessary" ook voor de (altijd-aan)
 * toggle van de noodzakelijke-cookies-categorie, niet voor de weiger-knop.
 * Dat woord staat alleen in de veiligere, samengestelde COMPACT_HINTS.
 */
export const ATTRIBUTE_REJECT_WORD_HINTS: readonly string[] = [
  'reject',
  'decline',
  'deny',
  'refuse',
];

export const ATTRIBUTE_REJECT_COMPACT_HINTS: readonly string[] = [
  'rejectall',
  'denyall',
  'declineall',
  'refuseall',
  'onlynecessary',
  'necessaryonly',
  'onlyessential',
  'essentialonly',
  'rejectcookies',
  'denycookies',
  'declinecookies',
  'cookiereject',
  'cmpreject',
  'consentreject',
];

/**
 * Guard: als dezelfde tokenset ook een accept-hint bevat, matchen we niet —
 * een class als "accept-and-reject-toggle" is te ambigu om blind te
 * vertrouwen. Bewust conservatief: liever een gemiste banner dan een per
 * ongeluk geaccepteerde.
 */
export const ATTRIBUTE_ACCEPT_GUARD_WORDS: readonly string[] = [
  'accept',
  'agree',
  'allow',
  'consent',
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
let remoteContextWords: string[] = [];
let remoteAttributeWordHints: string[] = [];
let remoteAttributeCompactHints: string[] = [];

/** Eén set remote keyword-velden — zelfde vorm als RemoteAutoclickFields in rules/types.ts. */
interface RemoteKeywordFields {
  rejectKeywords?: string[];
  ambiguousKeywords?: string[];
  stepIntoKeywords?: string[];
  rejectPhrases?: string[];
  contextWords?: string[];
  attributeWordHints?: string[];
  attributeCompactHints?: string[];
}

/**
 * v0.4.5 (fix #3, security-audit 2026-09-16): true als `ruleHost` van
 * toepassing is op `currentHost` — exacte match, of `currentHost` is een
 * subdomein van `ruleHost` (bv. regel `"example.com"` geldt ook voor
 * `"www.example.com"`). Nooit andersom: een regel op een subdomein geldt
 * niet voor de apex. Case-insensitive, zoals de rest van deze module.
 */
export function isHostRuleMatch(currentHost: string, ruleHost: string): boolean {
  const h = currentHost.toLowerCase().trim();
  const r = ruleHost.toLowerCase().trim();
  if (!h || !r) return false;
  return h === r || h.endsWith(`.${r}`);
}

/**
 * Injecteer remote keywords. Roep aan vanuit content scripts ná het lezen
 * van de gecachde rules uit chrome.storage.local.
 *
 * Inputs worden genormaliseerd (lowercase + whitespace) en gefilterd op
 * non-empty strings. `contextWords`/`attribute*Hints` gebruiken dezelfde
 * normalize() als de andere velden — voor attribuut-hints is dat vooral
 * de lowercase-stap die telt, tokens hebben toch al geen spaties.
 *
 * `currentHost` (optioneel, meestal `location.hostname`): als gezet, worden
 * ook de `hostRules`-entries die op deze host matchen (zie
 * `isHostRuleMatch()`) meegenomen — additief bovenop de globale velden.
 * Zonder `currentHost` (zoals de Phase 2B/2C-analyzer, die host-onafhankelijk
 * draait) worden alleen de globale velden gebruikt; host-scoped regels
 * blijven dan ongebruikt, wat veilig is (ze zijn per definitie een subset
 * van wat al globaal toegestaan zou zijn als de host niet bekend is).
 */
export function setRemoteKeywords(
  rules: RemoteKeywordFields & { hostRules?: Record<string, RemoteKeywordFields> },
  currentHost?: string,
): void {
  const merged: RemoteKeywordFields = {
    rejectKeywords: [...(rules.rejectKeywords ?? [])],
    ambiguousKeywords: [...(rules.ambiguousKeywords ?? [])],
    stepIntoKeywords: [...(rules.stepIntoKeywords ?? [])],
    rejectPhrases: [...(rules.rejectPhrases ?? [])],
    contextWords: [...(rules.contextWords ?? [])],
    attributeWordHints: [...(rules.attributeWordHints ?? [])],
    attributeCompactHints: [...(rules.attributeCompactHints ?? [])],
  };

  if (currentHost && rules.hostRules) {
    for (const [ruleHost, fields] of Object.entries(rules.hostRules)) {
      if (!isHostRuleMatch(currentHost, ruleHost)) continue;
      merged.rejectKeywords!.push(...(fields.rejectKeywords ?? []));
      merged.ambiguousKeywords!.push(...(fields.ambiguousKeywords ?? []));
      merged.stepIntoKeywords!.push(...(fields.stepIntoKeywords ?? []));
      merged.rejectPhrases!.push(...(fields.rejectPhrases ?? []));
      merged.contextWords!.push(...(fields.contextWords ?? []));
      merged.attributeWordHints!.push(...(fields.attributeWordHints ?? []));
      merged.attributeCompactHints!.push(...(fields.attributeCompactHints ?? []));
    }
  }

  remoteRejectPhrases = merged.rejectPhrases!.map(normalize).filter((s) => s.length > 0);
  remoteRejectKeywords = merged.rejectKeywords!.map(normalize).filter((s) => s.length > 0);
  remoteAmbiguousKeywords = merged.ambiguousKeywords!.map(normalize).filter((s) => s.length > 0);
  remoteStepIntoKeywords = merged.stepIntoKeywords!.map(normalize).filter((s) => s.length > 0);
  remoteContextWords = merged.contextWords!.map(normalize).filter((s) => s.length > 0);
  remoteAttributeWordHints = merged.attributeWordHints!.map(normalize).filter((s) => s.length > 0);
  remoteAttributeCompactHints = merged.attributeCompactHints!.map(normalize).filter((s) => s.length > 0);
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
 * bevat (substring-match, case-insensitive). Checkt zowel bundled als
 * remote context-woorden (nieuwe taal-context-woorden kunnen zo remote
 * bijgeleverd worden, net als de andere keyword-tiers).
 */
export function hasCookieContext(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    COOKIE_CONTEXT_WORDS.some((word) => lower.includes(word)) ||
    remoteContextWords.some((word) => lower.includes(word))
  );
}

/**
 * Returns true als de gegeven attribuut-tokens (al gesplitst op
 * kebab-case/camelCase/snake_case-grenzen door finder.ts) of de ruwe
 * ongesplitste attribuutstring een taalonafhankelijke reject-hint bevatten.
 *
 * Zie de uitgebreide toelichting bij ATTRIBUTE_REJECT_WORD_HINTS hierboven
 * voor de rationale en de twee-tiers-aanpak.
 */
export function isRejectAttributeHint(tokens: string[], raw: string): boolean {
  if (tokens.length === 0 && !raw) return false;

  const hasAcceptGuard = tokens.some((t) =>
    ATTRIBUTE_ACCEPT_GUARD_WORDS.includes(t),
  );
  if (hasAcceptGuard) return false;

  const wordMatch = tokens.some(
    (t) =>
      ATTRIBUTE_REJECT_WORD_HINTS.includes(t) ||
      remoteAttributeWordHints.includes(t),
  );
  if (wordMatch) return true;

  // Compact-check op zowel de ruwe string (vangt géén-scheidingsteken-vorm,
  // "rejectall") als de losse tokens aan elkaar geplakt (vangt kebab-case/
  // snake_case/camelCase-vormen met scheidingstekens ertussen, zoals
  // "necessary-only" → tokens ['necessary','only'] → 'necessaryonly').
  // Allebei zijn substring-checks tegen bewust samengestelde, specifieke
  // fragmenten — geen los woord — dus het risico op een toevallige match
  // blijft laag.
  const normalizedRaw = raw.toLowerCase();
  const joinedTokens = tokens.join('');
  const compactCandidates = [normalizedRaw, joinedTokens].filter((s) => s.length > 0);
  if (compactCandidates.length === 0) return false;

  return (
    ATTRIBUTE_REJECT_COMPACT_HINTS.some((hint) =>
      compactCandidates.some((c) => c.includes(hint)),
    ) ||
    remoteAttributeCompactHints.some((hint) =>
      compactCandidates.some((c) => c.includes(hint)),
    )
  );
}
