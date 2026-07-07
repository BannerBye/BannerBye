/**
 * Phase 2C — Claude judge.
 *
 * Beoordeelt of een voorgesteld reject-keyword écht "consent weigeren" betekent.
 * Alleen bij verdict=approve + confidence=high mag het automatisch live.
 *
 * Anthropic Messages API via fetch (geen SDK-dependency, net als de Resend-call).
 * Env: ANTHROPIC_API_KEY.
 *
 * FAIL-SAFE: bij elke fout (geen key, HTTP-error, onparseerbare output) geven we
 * verdict=reject / confidence=low terug — nooit een per ongeluk auto-apply.
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
