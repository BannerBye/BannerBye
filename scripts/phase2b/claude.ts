/**
 * Phase 2C — Claude judge + taalgat-generator.
 *
 * Twee losse rollen, bewust gescheiden:
 *   1. judgeKeyword() — beoordeelt of een al-voorgesteld keyword veilig is.
 *   2. proposeLanguageGapKeywords() — genereert zelf kandidaat-keywords
 *      wanneer classify.ts een `possible_language_gap` tegenkomt (v0.4.4):
 *      een banner met knoppen die géén enkele bekende taal/indicator matchen
 *      (het coffeeisland.gr-patroon, sep 2026).
 *
 * Elk gegenereerd voorstel van (2) gaat ALTIJD nog een keer door (1) heen
 * vóór het auto-toegepast mag worden (zie analyze.ts) — een generator die
 * zijn eigen werk beoordeelt is geen onafhankelijke controle. Alleen
 * verdict=approve + confidence=high uit de ONAFHANKELIJKE judge-call mag live.
 *
 * Anthropic Messages API via fetch (geen SDK-dependency, net als de Resend-call).
 * Env: ANTHROPIC_API_KEY.
 *
 * FAIL-SAFE: bij elke fout (geen key, HTTP-error, onparseerbare output) geven
 * beide functies een leeg/afwijzend resultaat terug — nooit een per ongeluk
 * auto-apply.
 */

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5-20251001';

export type Verdict = 'approve' | 'reject';
export type Confidence = 'high' | 'medium' | 'low';

export interface Judgement {
  verdict: Verdict;
  confidence: Confidence;
  reason: string;
}

export type KeywordList = 'reject' | 'ambiguous' | 'stepInto';

export interface JudgeInput {
  /** Genormaliseerd voorgesteld keyword, bv. "reject additional cookies". */
  keyword: string;
  /** De originele knop-tekst zoals op de site. */
  buttonText: string;
  /** Korte snippet van de banner-tekst (context). */
  bannerSnippet: string;
  /** Hostname waar het voorstel vandaan komt. */
  hostname: string;
  /** Doellijst — bepaalt hoe streng we oordelen. Default 'reject'. */
  list?: KeywordList;
}

const SYSTEM = `Je beoordeelt of een knop-tekst van een cookie-banner veilig automatisch aangeklikt mag worden door een browser-extensie die namens de gebruiker consent WEIGERT. Het keyword wordt bij approve+high automatisch live op miljoenen sites. Een fout is duur.

Er zijn drie soorten voorstellen:
- reject: een directe weiger-knop. Keur alleen approve/high bij een ondubbelzinnige weiger-betekenis (bv. "reject additional cookies", "alleen noodzakelijke cookies", "decline optional cookies").
- ambiguous: een "opslaan/bevestigen"-knop in een detail-paneel. Alleen veilig als hij de keuze bewaart ZONDER extra consent te geven (bv. "save necessary only", "bevestig mijn keuze"). Bij enige kans dat hij toestemming vastlegt: NIET hoog.
- stepInto: een knop die alleen een instellingen-/detail-paneel OPENT (geeft zelf geen consent). Keur approve/high als het duidelijk een "aanpassen / meer opties / instellingen"-knop is.

Keur NOOIT goed als de knop consent kan GEVEN (accepteren/toestaan/akkoord).

Antwoord UITSLUITEND met JSON, geen extra tekst:
{"verdict":"approve"|"reject","confidence":"high"|"medium"|"low","reason":"<korte uitleg>"}`;

const LIST_HINT: Record<KeywordList, string> = {
  reject: 'Type: directe weiger-knop. Betekent deze knop ondubbelzinnig consent weigeren?',
  ambiguous:
    'Type: opslaan/bevestigen-knop in een detail-paneel. Keur alleen hoog als hij de (default-uit) keuze bewaart zonder extra consent te geven; twijfel = niet hoog.',
  stepInto:
    'Type: knop die alleen een instellingen-/detail-paneel opent (geen consent). Keur hoog als het duidelijk een aanpassen/meer-opties/instellingen-knop is.',
};

function safeDefault(reason: string): Judgement {
  return { verdict: 'reject', confidence: 'low', reason };
}

export async function judgeKeyword(input: JudgeInput): Promise<Judgement> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return safeDefault('ANTHROPIC_API_KEY ontbreekt');

  const list: KeywordList = input.list ?? 'reject';
  const userMsg = [
    LIST_HINT[list],
    ``,
    `Voorgesteld keyword (genormaliseerd): "${input.keyword}"`,
    `Originele knop-tekst: "${input.buttonText}"`,
    `Site: ${input.hostname}`,
    `Banner-context (ingekort): "${input.bannerSnippet.slice(0, 280)}"`,
    ``,
    `Geef je oordeel als JSON.`,
  ].join('\n');

  try {
    const res = await fetch(ANTHROPIC_ENDPOINT, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 200,
        system: SYSTEM,
        messages: [{ role: 'user', content: userMsg }],
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error('[claude] HTTP error', res.status, body.slice(0, 300));
      return safeDefault(`Claude HTTP ${res.status}`);
    }
    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text =
      data.content?.find((c) => c.type === 'text')?.text?.trim() ?? '';
    const json = extractJson(text);
    if (!json) return safeDefault('Claude-output niet parseerbaar');

    const verdict: Verdict = json.verdict === 'approve' ? 'approve' : 'reject';
    const confidence: Confidence =
      json.confidence === 'high'
        ? 'high'
        : json.confidence === 'medium'
          ? 'medium'
          : 'low';
    const reason =
      typeof json.reason === 'string' ? json.reason.slice(0, 300) : '';
    return { verdict, confidence, reason };
  } catch (err) {
    console.error('[claude] judge failed:', err);
    return safeDefault('Claude-call gefaald');
  }
}

/** Haal het eerste JSON-object uit een tekst (Claude kan soms tekst eromheen zetten). */
function extractJson(
  text: string,
): { verdict?: string; confidence?: string; reason?: string } | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Of een oordeel "auto-live" mag (beide sloten dicht). */
export function isAutoApprove(j: Judgement): boolean {
  return j.verdict === 'approve' && j.confidence === 'high';
}

// ---------------------------------------------------------------------------
// v0.4.4 — taalgat-generator
// ---------------------------------------------------------------------------

export interface LanguageGapCandidateInput {
  hostname: string;
  bannerSnippet: string;
  /** `document.documentElement.lang`, indien gezet. */
  pageLang: string;
  /** true als deze banner alleen via het zwakke vormsignaal gevonden is
   * (detect.ts) — Claude moet dan EERST beoordelen of dit wel een
   * cookie-banner is, niet aannemen dat het er één is. */
  weakSignal: boolean;
  candidateTexts: string[];
}

export interface LanguageGapProposal {
  /** De originele knop-tekst zoals op de site. */
  buttonText: string;
  /** Genormaliseerd voorstel (lowercase/trim) — zelfde vorm als normalize(). */
  keyword: string;
  list: KeywordList;
  /**
   * Variant zonder diakritische tekens, ALLEEN als het schrift van deze taal
   * ze normaal laat vallen in hoofdletter-UI (zoals Grieks — zie de
   * coffeeisland.gr-les in keywords.ts). Leeg als niet van toepassing.
   */
  variantWithoutDiacritics?: string;
}

export interface LanguageGapResult {
  /** Of Claude dit überhaupt als een cookie-consent-banner beoordeelt. */
  isConsentBanner: boolean;
  detectedLanguage?: string;
  proposals: LanguageGapProposal[];
  note: string;
}

function emptyLanguageGapResult(note: string): LanguageGapResult {
  return { isConsentBanner: false, proposals: [], note };
}

const LANGUAGE_GAP_SYSTEM = `Je krijgt de knop-teksten van een banner op een website, in een taal die onze bestaande keyword-lijsten (Engels, Nederlands, Duits, Frans, Spaans, Italiaans, Grieks) niet dekken.

Twee taken, in deze volgorde:

1. Beoordeel EERST of dit überhaupt een cookie/privacy-consent-banner is — niet elke fixed/sticky balk met knoppen is dat (het kan een nieuwsbrief-aanmelding, een taalkeuze, een app-download-balk, of iets anders zijn). Als je twijfelt: isConsentBanner=false.

2. Alleen als het wél een consent-banner is: identificeer per knop-tekst of hij een van deze betekent:
   - "reject": weigert ALLE niet-noodzakelijke cookies/tracking ondubbelzinnig (bv. "alleen noodzakelijke cookies", "weiger alles"). Dit is de belangrijkste categorie.
   - "stepInto": opent ALLEEN een instellingen-/voorkeuren-paneel, geeft zelf GEEN consent (bv. "instellingen", "meer opties", "aanpassen").
   Knoppen die consent GEVEN (accepteren/toestaan/akkoord) noem je NOOIT — ook niet per ongeluk als "reject". Bij twijfel over een knop: laat 'm weg in plaats van te gokken.

Voor elk voorstel: geef ook het genormaliseerde keyword (lowercase, spaties getrimd, geen leestekens aan begin/eind — precies zoals de knoptekst maar genormaliseerd).

BELANGRIJK — diakritische tekens: sommige schriften (zoals Grieks) laten in hoofdletter-UI-tekst het accent/diakritisch teken vaak weg, en lowercase()-conversie herstelt dat niet (bv. Grieks "ΔΕ ΣΥΜΦΩΝΩ" wordt "δε συμφωνω", NIET het geaccentueerde "δε συμφωνώ"). Als je zo'n taal herkent: geef in variantWithoutDiacritics ook de versie mét alle diakritische tekens weggehaald (NFD-normalisatie, combining marks strippen). Voor talen zonder dit fenomeen: laat variantWithoutDiacritics leeg.

Antwoord UITSLUITEND met JSON, geen extra tekst:
{"isConsentBanner": true|false, "detectedLanguage": "<taalnaam of ISO-code>", "proposals": [{"buttonText":"<originele tekst>","keyword":"<genormaliseerd>","list":"reject"|"stepInto","variantWithoutDiacritics":"<optioneel>"}], "note": "<korte toelichting, ook waarom je iets NIET voorstelde>"}`;

/**
 * Genereert kandidaat-keywords voor een banner in een onbekende taal.
 *
 * Dit VERVANGT niet de judge-stap — elk proposal hierin moet daarna nog
 * apart door judgeKeyword() vóór het mag auto-toepassen (zie analyze.ts).
 * Faalt altijd stil naar een leeg resultaat.
 */
export async function proposeLanguageGapKeywords(
  input: LanguageGapCandidateInput,
): Promise<LanguageGapResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return emptyLanguageGapResult('ANTHROPIC_API_KEY ontbreekt');
  if (!input.candidateTexts.length) return emptyLanguageGapResult('geen kandidaat-knoppen');

  const userMsg = [
    `Site: ${input.hostname}`,
    input.pageLang ? `Pagina-taal (html lang-attribuut): ${input.pageLang}` : `Pagina-taal: onbekend`,
    input.weakSignal
      ? `Let op: deze banner is alleen via een zwak vormsignaal gevonden (geen bekend cookie/consent-woord herkend in de tekst) — controleer dus extra kritisch of dit wel een consent-banner is.`
      : `Deze container bevat wél een herkend cookie/consent-signaalwoord (mogelijk als Engels leenwoord) — waarschijnlijk een echte consent-banner.`,
    `Banner-tekst (ingekort): "${input.bannerSnippet.slice(0, 400)}"`,
    ``,
    `Knop-teksten:`,
    ...input.candidateTexts.slice(0, 12).map((t, i) => `${i + 1}. "${t}"`),
    ``,
    `Geef je analyse als JSON.`,
  ].join('\n');

  try {
    const res = await fetch(ANTHROPIC_ENDPOINT, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 800,
        system: LANGUAGE_GAP_SYSTEM,
        messages: [{ role: 'user', content: userMsg }],
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error('[claude] taalgat HTTP error', res.status, body.slice(0, 300));
      return emptyLanguageGapResult(`Claude HTTP ${res.status}`);
    }
    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text = data.content?.find((c) => c.type === 'text')?.text?.trim() ?? '';
    const json = extractLanguageGapJson(text);
    if (!json) return emptyLanguageGapResult('Claude-output niet parseerbaar');

    const rawProposals = Array.isArray(json.proposals) ? json.proposals : [];
    const proposals: LanguageGapProposal[] = rawProposals
      .filter(
        (p): p is Record<string, unknown> =>
          !!p && typeof p === 'object' &&
          typeof (p as Record<string, unknown>).buttonText === 'string' &&
          typeof (p as Record<string, unknown>).keyword === 'string' &&
          ((p as Record<string, unknown>).list === 'reject' ||
            (p as Record<string, unknown>).list === 'stepInto'),
      )
      .map((p) => ({
        buttonText: String(p.buttonText).slice(0, 200),
        keyword: String(p.keyword).slice(0, 200).trim().toLowerCase(),
        list: p.list as KeywordList,
        variantWithoutDiacritics:
          typeof p.variantWithoutDiacritics === 'string' && p.variantWithoutDiacritics.trim()
            ? p.variantWithoutDiacritics.trim().toLowerCase().slice(0, 200)
            : undefined,
      }))
      .filter((p) => p.keyword.length > 0);

    return {
      isConsentBanner: json.isConsentBanner === true,
      detectedLanguage:
        typeof json.detectedLanguage === 'string' ? json.detectedLanguage.slice(0, 60) : undefined,
      proposals: json.isConsentBanner === true ? proposals : [],
      note: typeof json.note === 'string' ? json.note.slice(0, 400) : '',
    };
  } catch (err) {
    console.error('[claude] taalgat-call gefaald:', err);
    return emptyLanguageGapResult('Claude-call gefaald');
  }
}

function extractLanguageGapJson(text: string): {
  isConsentBanner?: unknown;
  detectedLanguage?: unknown;
  proposals?: unknown;
  note?: unknown;
} | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}
