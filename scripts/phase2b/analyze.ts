/**
 * Phase 2B/2C — main analyzer. v2 sinds 0.4.17 (9 nov 2026).
 *
 * WAAROM V2
 * De eerste versie bezocht alleen `https://{host}/` met één desktop-profiel
 * en noemde "geen banner gevonden" een waarschijnlijk vals positief. Dat was
 * te vaak onwaar (portal.newdaycards.com: root 404, banner op /aqua/login,
 * melder op Android). Robin moest dan zelf de site openen en alsnog de bug
 * vinden. V2 draait de bewijslast om: de pijplijn moet kunnen laten zien wat
 * ze geprobeerd heeft, en "niet gereproduceerd" is een wachtrij-status, geen
 * eindoordeel.
 *
 * WAT V2 DOET, per gemelde host
 *   1. Leest wat de melder zag (v0.4.17-meldingen): pad, taal, user-agent en
 *      een DOM-snapshot van de banner-knoppen (src/lib/report-snapshot.ts).
 *   2. Bezoekt de site in meerdere profielen: eerst zoals de melder (mobiel
 *      of desktop, zelfde pad, zelfde taal), daarna de root met een desktop.
 *      Bij een herhaalpoging (zie 6) met andere profielen en langer wachten.
 *   3. Detecteert, klikt zo nodig de step-into-knop en classificeert — met de
 *      keyword-lijsten die op DÉZE host gelden (globaal + hostRules).
 *   4. Ziet headless niets maar de snapshot wél een banner, dan is de
 *      snapshot het bewijs: dezelfde classificatie draait op de knoplabels
 *      die de melder zag. Een taalgat gaat ook hier door de taalgat-generator.
 *   5. Claude beoordeelt elk voorstel (onafhankelijke judge, zie claude.ts).
 *      approve/high → `hostrules-to-apply.json`: de workflow zet het keyword
 *      HOST-SCOPED (autoclick.hostRules[host]) op main. Dat is een bewuste,
 *      afgebakende uitzondering op security-fix #1 (2026-09-16): de blast
 *      radius is één host, het keyword komt uit een echte banner op die host,
 *      en Claude keurde het met hoge zekerheid goed. Globale keywords gaan
 *      nog steeds uitsluitend via de review-PR; een host-keyword dat op twee
 *      of meer hosts voorkomt wordt daar automatisch voor voorgedragen.
 *      approve/medium|low → review-PR zoals voorheen. reject → alleen gemeld.
 *   6. Geen banner in geen enkel profiel én geen bruikbare snapshot → NIET
 *      "vals positief" maar een herhaalpoging (bb:retry, elke 6 uur, max 3)
 *      met andere profielen. Daarna pas: "jouw blik nodig", met alles wat er
 *      geprobeerd is op een rij.
 *   7. Mail aan Robin: per host wat de melder zag, wat wij probeerden, wat de
 *      uitkomst is en wat hij nog moet doen (meestal: niets). Claude schrijft
 *      er een duiding van twee zinnen bij.
 *
 * Env: KV_REST_API_URL/TOKEN (verplicht), ANTHROPIC_API_KEY, RESEND_API_KEY,
 *      MAX_HOSTS (25), NAV_TIMEOUT_MS (20000), WAIT_MS (3500),
 *      PANEL_WAIT_MS (1800), RULES_FILE, RETRY_MODE (1 = alleen de wachtrij).
 */

import { appendFile, writeFile } from 'node:fs/promises';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { setRemoteKeywords, normalize, isStepIntoText } from '../../src/lib/autoclick/keywords.ts';
import {
  getRedis,
  getHostsToAnalyze,
  markAnalyzed,
  writeAnalysis,
  recordPendingFix,
  promotePendingFixes,
  setHostStatus,
  scheduleRetry,
  getDueRetries,
  clearRetry,
  getRetryMeta,
  RETRY_MAX_ATTEMPTS,
  type HostWork,
  type ReportSnapshot,
} from './redis.ts';
import { sendOwnerSummaryEmail, type OwnerHostBlock } from './notify.ts';
import { buildDetectScript, type DetectionResult } from './detect.ts';
import { detectionFromSnapshot, safePath } from './evidence.ts';
import { bannerStructureSignals } from '../../src/lib/autoclick/banner-structure.ts';
import {
  classify,
  classifyStepPanel,
  type Classification,
  type KeywordProposal,
} from './classify.ts';
import { loadRules, keywordsForHost, hostRuleKeywordsSeenOn } from './rules.ts';
import {
  judgeKeyword,
  isAutoApprove,
  proposeLanguageGapKeywords,
  explainForOwner,
  type Judgement,
} from './claude.ts';

const DETECT_SCRIPT = buildDetectScript(bannerStructureSignals.toString());

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EvidenceSource = 'headless' | 'snapshot';

interface Proposal extends KeywordProposal {
  buttonText: string;
  bannerSnippet: string;
  hostname: string;
  source: EvidenceSource;
  variantWithoutDiacritics?: string;
  fromLanguageGap?: boolean;
}
interface JudgedProposal extends Proposal {
  judgement: Judgement;
}

interface Profile {
  name: string;
  userAgent: string;
  viewport: { width: number; height: number };
  locale: string;
  isMobile: boolean;
  hasTouch: boolean;
  deviceScaleFactor: number;
  waitMs: number;
  scroll: boolean;
}

interface Visit {
  profile: string;
  url: string;
  status: number | null;
  finalUrl: string;
  bannerVisible: boolean;
  category: Classification['category'];
  note: string;
  detection: DetectionResult | null;
  classification: Classification | null;
  stepIntoButtonText?: string;
  error?: string;
}

interface HostResult {
  host: string;
  work: HostWork;
  visits: Visit[];
  /** Beste classificatie: headless > snapshot > no_banner. */
  classification: Classification;
  detection: DetectionResult | null;
  source: EvidenceSource | 'none';
  stepIntoButtonText?: string;
  error?: string;
  languageGapNote?: string;
  wallFromTrace: boolean;
  snapshotHadBanner: boolean;
  denied?: boolean;
}

type Outcome =
  | { kind: 'live'; keywords: JudgedProposal[] }
  | { kind: 'review'; keywords: JudgedProposal[] }
  | { kind: 'rejected'; keywords: JudgedProposal[] }
  | { kind: 'wall' }
  | { kind: 'accept_only' }
  | { kind: 'cmp_iframe' }
  | { kind: 'language_gap' }
  | { kind: 'retry'; attempt: number; nextInHours: number }
  | { kind: 'needs_human'; attempts: number }
  | { kind: 'error'; message: string }
  | { kind: 'unknown'; reason: string };

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const MAX_HOSTS = Number(process.env.MAX_HOSTS ?? '25');
const NAV_TIMEOUT_MS = Number(process.env.NAV_TIMEOUT_MS ?? '20000');
const WAIT_MS = Number(process.env.WAIT_MS ?? '3500');
const PANEL_WAIT_MS = Number(process.env.PANEL_WAIT_MS ?? '1800');
const RETRY_MODE = process.env.RETRY_MODE === '1';

const CLICKABLE =
  'button, [role="button"], a, input[type="button"], input[type="submit"], [class*="button"], [class*="btn"], [onclick]';

const UA_DESKTOP =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const UA_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const UA_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// SSRF-denylist (fix #4) — zie api/report.ts voor de toelichting.
const DENIED_EXACT_HOSTS = new Set([
  'localhost', 'localhost.localdomain', 'ip6-localhost', 'ip6-loopback',
  'broadcasthost', 'metadata', 'metadata.google.internal', 'metadata.internal',
]);

function isDeniedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (DENIED_EXACT_HOSTS.has(h)) return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a > 255 || b > 255 || Number(m[3]) > 255 || Number(m[4]) > 255) return true;
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Profielen: eerst zoals de melder, dan breder
// ---------------------------------------------------------------------------

function reporterIsMobile(ua: string | undefined): 'android' | 'iphone' | null {
  if (!ua) return null;
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iphone';
  return null;
}

function localeFrom(lang: string | undefined, fallback: string): string {
  if (!lang) return fallback;
  const m = lang.match(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?/);
  return m ? m[0] : fallback;
}

function makeProfile(
  name: string,
  kind: 'desktop' | 'android' | 'iphone',
  locale: string,
  opts: { viewport?: { w: number; h: number }; waitMs?: number; scroll?: boolean } = {},
): Profile {
  if (kind === 'desktop') {
    return {
      name,
      userAgent: UA_DESKTOP,
      viewport: { width: 1280, height: 900 },
      locale,
      isMobile: false,
      hasTouch: false,
      deviceScaleFactor: 1,
      waitMs: opts.waitMs ?? WAIT_MS,
      scroll: opts.scroll ?? false,
    };
  }
  const vp = opts.viewport && opts.viewport.w >= 280 && opts.viewport.h >= 400
    ? { width: Math.min(opts.viewport.w, 1024), height: Math.min(opts.viewport.h, 1400) }
    : { width: 390, height: 844 };
  return {
    name,
    userAgent: kind === 'android' ? UA_ANDROID : UA_IPHONE,
    viewport: vp,
    locale,
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
    waitMs: opts.waitMs ?? WAIT_MS,
    scroll: opts.scroll ?? false,
  };
}

/** Bezoekplan per poging. Poging 1 = de melding zelf; 2 en 3 variëren. */
function buildPlan(work: HostWork, attempt: number): Array<{ profile: Profile; path: string }> {
  const path = safePath(work.path);
  const mobile = reporterIsMobile(work.ua);
  const locale = localeFrom(work.lang ?? work.snapshot?.uiLang, 'nl-NL');
  const vp = work.snapshot?.viewport;
  const plan: Array<{ profile: Profile; path: string }> = [];

  if (attempt <= 1) {
    plan.push({
      profile: makeProfile(
        mobile ? `zoals melder (${mobile === 'android' ? 'Android Chrome' : 'iPhone Safari'}, ${locale})` : `zoals melder (desktop, ${locale})`,
        mobile ?? 'desktop',
        locale,
        { viewport: vp },
      ),
      path,
    });
    if (path !== '/' || mobile) {
      plan.push({ profile: makeProfile('desktop nl-NL op /', 'desktop', 'nl-NL'), path: '/' });
    }
  } else if (attempt === 2) {
    plan.push({ profile: makeProfile(`iPhone Safari ${locale}, langer wachten`, 'iphone', locale, { waitMs: 7000, scroll: true }), path });
    plan.push({ profile: makeProfile('desktop en-US op /, scrollen', 'desktop', 'en-US', { waitMs: 6000, scroll: true }), path: '/' });
  } else {
    plan.push({ profile: makeProfile(`Android Chrome ${locale}, 9 s wachten`, 'android', locale, { waitMs: 9000, scroll: true }), path });
    plan.push({ profile: makeProfile(`desktop ${locale} op pad, scrollen`, 'desktop', locale, { waitMs: 7000, scroll: true }), path });
    if (path !== '/') plan.push({ profile: makeProfile('desktop de-DE op /', 'desktop', 'de-DE', { waitMs: 6000 }), path: '/' });
  }
  return plan;
}

// ---------------------------------------------------------------------------
// Eén bezoek
// ---------------------------------------------------------------------------

async function visit(browser: Browser, host: string, path: string, profile: Profile): Promise<Visit> {
  const url = `https://${host}${path}`;
  const base: Visit = {
    profile: profile.name,
    url,
    status: null,
    finalUrl: '',
    bannerVisible: false,
    category: 'no_banner',
    note: '',
    detection: null,
    classification: null,
  };
  let context: BrowserContext | null = null;
  try {
    context = await browser.newContext({
      userAgent: profile.userAgent,
      locale: profile.locale,
      viewport: profile.viewport,
      isMobile: profile.isMobile,
      hasTouch: profile.hasTouch,
      deviceScaleFactor: profile.deviceScaleFactor,
      extraHTTPHeaders: { 'Accept-Language': `${profile.locale},${profile.locale.slice(0, 2)};q=0.9,en;q=0.7` },
    });
    const page = await context.newPage();
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    base.status = resp?.status() ?? null;
    await page.waitForTimeout(profile.waitMs);
    if (profile.scroll) {
      try {
        await page.mouse.wheel(0, 600);
        await page.waitForTimeout(800);
        await page.mouse.wheel(0, -600);
        await page.waitForTimeout(600);
      } catch {
        // scrollen is bijzaak
      }
    }
    const detection = (await page.evaluate(DETECT_SCRIPT)) as DetectionResult;
    base.finalUrl = detection.finalUrl;
    base.detection = detection;
    base.bannerVisible = detection.bannerVisible;
    const classification = classify(detection);
    base.classification = classification;
    base.category = classification.category;
    base.note = classification.reason;

    if (classification.category === 'needs_step_into' && classification.stepIntoButtonText) {
      const btn = classification.stepIntoButtonText;
      base.stepIntoButtonText = btn;
      try {
        await page
          .locator(CLICKABLE, { hasText: new RegExp(`^\\s*${escapeRegExp(btn)}\\s*$`, 'i') })
          .first()
          .click({ timeout: 3000 });
        await page.waitForTimeout(PANEL_WAIT_MS);
        const panel = (await page.evaluate(DETECT_SCRIPT)) as DetectionResult;
        const panelClass = classifyStepPanel(panel, btn, detection.cmps);
        base.detection = panel;
        base.classification = panelClass;
        base.category = panelClass.category;
        base.note = panelClass.reason;
      } catch (err) {
        base.classification = {
          category: 'unknown',
          proposals: [],
          reason: `Step-into knop "${btn}" gevonden maar klikken/heranalyseren faalde: ${err instanceof Error ? err.message : String(err)}`,
          cmps: detection.cmps,
        };
        base.category = 'unknown';
        base.note = base.classification.reason;
      }
    }
    return base;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ...base, error: msg.slice(0, 200), note: `Kon niet laden: ${msg.slice(0, 120)}` };
  } finally {
    if (context) await context.close().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Snapshot als bewijs
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Host analyseren
// ---------------------------------------------------------------------------

function traceSaysWall(trace: string | undefined, message: string | undefined): boolean {
  const hay = `${trace ?? ''}\n${message ?? ''}`;
  return /^t=\+\d+ms\s+(wall|result)\s+.*\bwall\b/m.test(hay);
}

async function analyzeHost(browser: Browser, work: HostWork, attempt: number): Promise<HostResult> {
  const host = work.hostname;
  const wallFromTrace = traceSaysWall(work.trace, work.sampleMessage);
  const snapshotHadBanner = !!work.snapshot && (work.snapshot.bannerFound || work.snapshot.candidates.some((c) => c.inBanner));
  const empty: Classification = { category: 'no_banner', proposals: [], reason: '', cmps: [] };

  if (isDeniedHostname(host)) {
    return {
      host, work, visits: [], detection: null, source: 'none', wallFromTrace, snapshotHadBanner, denied: true,
      classification: { ...empty, category: 'unknown', reason: 'Hostname staat op de SSRF-denylist (loopback/private/metadata) — niet bezocht.' },
    };
  }

  const visits: Visit[] = [];
  for (const step of buildPlan(work, attempt)) {
    const v = await visit(browser, host, step.path, step.profile);
    visits.push(v);
    console.log(
      `   bezoek [${v.profile}] ${v.url} → ${v.status ?? 'geen antwoord'}${v.error ? ` · FOUT ${v.error}` : ''} · banner ${v.bannerVisible ? 'ZICHTBAAR' : 'niet gezien'} · ${v.category}`,
    );
    if (v.bannerVisible) break; // bewijs gevonden — niet verder zoeken
  }

  // 1. Headless zag een banner → dat is het bewijs.
  const seen = visits.find((v) => v.bannerVisible && v.classification);
  if (seen) {
    return {
      host, work, visits, detection: seen.detection, classification: seen.classification!, source: 'headless',
      stepIntoButtonText: seen.stepIntoButtonText, wallFromTrace, snapshotHadBanner,
    };
  }

  // 2. CMP-signature zonder leesbare banner (iframe) telt zwaarder dan "niets".
  const iframeCase = visits.find((v) => v.category === 'cmp_iframe_unreachable' && v.classification);
  if (iframeCase) {
    return {
      host, work, visits, detection: iframeCase.detection, classification: iframeCase.classification!, source: 'headless',
      wallFromTrace, snapshotHadBanner,
    };
  }

  // 3. De snapshot van de melder als bewijs.
  if (work.snapshot) {
    const det = detectionFromSnapshot(host, work, work.snapshot);
    if (det) {
      let cls = classify(det);
      if (cls.category === 'needs_step_into' && cls.stepIntoButtonText) {
        // Het paneel achter die knop kunnen we uit een snapshot niet zien.
        // Stel de knop zelf voor als die nog niet gedekt is; het paneel wordt
        // bij de volgende headless-poging alsnog gezocht.
        const btn = cls.stepIntoButtonText;
        const proposals: KeywordProposal[] = [];
        const n = normalize(btn);
        if (n && !isStepIntoText(btn)) proposals.push({ keyword: n, list: 'stepInto' });
        cls = {
          category: proposals.length ? 'step_into' : 'unknown',
          proposals,
          reason: proposals.length
            ? `Snapshot van de melder: geen directe weiger-knop, wél een instellingen-knop "${btn}" die nog niet gedekt was. Het paneel erachter is in een snapshot niet zichtbaar.`
            : `Snapshot van de melder: instellingen-knop "${btn}" is al gedekt; het paneel erachter is in een snapshot niet zichtbaar — headless kon de banner niet reproduceren.`,
          cmps: det.cmps,
          stepIntoButtonText: btn,
        };
      }
      return {
        host, work, visits, detection: det, classification: cls, source: 'snapshot',
        stepIntoButtonText: cls.stepIntoButtonText, wallFromTrace, snapshotHadBanner,
      };
    }
  }

  // 4. Niets. Alle bezoeken mislukt → fout; anders eerlijk "niet gereproduceerd".
  const allErrors = visits.length > 0 && visits.every((v) => v.error);
  return {
    host, work, visits, detection: null, source: 'none', wallFromTrace, snapshotHadBanner,
    error: allErrors ? visits.map((v) => v.error).join(' | ').slice(0, 300) : undefined,
    classification: {
      ...empty,
      reason: allErrors
        ? 'Geen enkel bezoek kon de pagina laden.'
        : 'In geen enkel profiel een zichtbare consent-banner gezien; geen snapshot met bannerbewijs.',
    },
  };
}

// ---------------------------------------------------------------------------
// Rapportage
// ---------------------------------------------------------------------------

function describeReporter(work: HostWork): string {
  const parts: string[] = [];
  parts.push(`pad ${safePath(work.path)}`);
  const mob = reporterIsMobile(work.ua);
  if (work.ua) {
    const browser = /Firefox\/(\d+)/.exec(work.ua)?.[0] ?? /Chrome\/(\d+)/.exec(work.ua)?.[0] ?? (/Safari/.test(work.ua) ? 'Safari' : '');
    parts.push(`${mob === 'android' ? 'Android' : mob === 'iphone' ? 'iPhone/iPad' : 'desktop'}${browser ? ` ${browser.replace('/', ' ')}` : ''}`);
  }
  if (work.lang) parts.push(work.lang);
  if (work.version) parts.push(`BannerBye ${work.version}`);
  const s = work.snapshot;
  if (s) {
    const inB = s.candidates.filter((c) => c.inBanner).map((c) => `"${c.text}"`);
    parts.push(
      inB.length
        ? `${inB.length} knop(pen) in de banner: ${inB.slice(0, 6).join(', ')}${inB.length > 6 ? ', …' : ''}`
        : s.candidates.length
          ? `geen banner-container herkend; consent-achtige knoppen: ${s.candidates.slice(0, 5).map((c) => `"${c.text}"`).join(', ')}`
          : 'geen consent-achtige knoppen zichtbaar',
    );
    if (s.cmps.length) parts.push(`CMP: ${s.cmps.join(', ')}`);
    if (s.iframes.length) parts.push(`consent-iframes: ${s.iframes.join(', ')}`);
  } else {
    parts.push('geen snapshot (melding van vóór 0.4.17)');
  }
  return parts.join(' · ');
}

function describeVisits(r: HostResult): string {
  if (r.denied) return 'niet bezocht (denylist)';
  if (!r.visits.length) return 'niet bezocht';
  return r.visits
    .map((v) => {
      const st = v.error ? `fout: ${v.error.slice(0, 60)}` : `HTTP ${v.status ?? '?'}`;
      const red = v.finalUrl && v.finalUrl.replace(/\/$/, '') !== v.url.replace(/\/$/, '') ? ` → ${v.finalUrl.slice(0, 80)}` : '';
      return `${v.profile}: ${v.url.replace(`https://${r.host}`, '') || '/'} (${st}${red}) — ${v.bannerVisible ? 'banner gezien' : 'geen banner'}`;
    })
    .join(' · ');
}

function fmtKw(p: JudgedProposal): string {
  return `${p.list} "${p.keyword}"${p.fromLanguageGap ? ' [nieuwe taal]' : ''} (${p.source === 'headless' ? 'headless geverifieerd' : 'uit snapshot melder'}, Claude ${p.judgement.verdict}/${p.judgement.confidence})`;
}

function describeOutcome(o: Outcome, r: HostResult): { outcome: string; todo: string } {
  switch (o.kind) {
    case 'live':
      return {
        outcome: `LIVE — host-regel voor ${r.host} toegevoegd: ${o.keywords.map(fmtKw).join('; ')}. Gaat mee met de eerstvolgende rules-refresh van de extensie (max. 24 u). Ticket staat op fixed, /fixed bijgewerkt.`,
        todo: 'niets',
      };
    case 'review':
      return {
        outcome: `NAAR REVIEW — voorstel met lagere zekerheid: ${o.keywords.map((p) => `${fmtKw(p)}: ${p.judgement.reason}`).join('; ')}. Staat in de review-PR.`,
        todo: 'PR beoordelen en mergen (of sluiten)',
      };
    case 'rejected':
      return {
        outcome: `AFGEWEZEN DOOR CLAUDE — ${o.keywords.map((p) => `"${p.keyword}": ${p.judgement.reason}`).join('; ')}. Niets toegepast.`,
        todo: 'alleen als je het oneens bent: keyword handmatig in rules.json zetten',
      };
    case 'wall':
      return { outcome: 'TOESTEMMEN-OF-BETALEN-MUUR — toestemmen of betalen, geen gratis weigerroute; BannerBye klikt daar bewust niets (issue #6). Ticket op not-a-bug.', todo: 'niets' };
    case 'accept_only':
      return { outcome: 'ACCEPT-ONLY — alleen accepteer-knoppen, geen weiger-optie en geen instellingen-knop. Niet oplosbaar via klikken. Ticket op not-a-bug.', todo: 'niets' };
    case 'cmp_iframe':
      return { outcome: `CMP IN IFRAME — signature gezien (${r.classification.cmps.join(', ') || '?'}) maar de banner-UI zit in een cross-origin iframe die de scanner niet leest. Laag 3 (Autoconsent) hoort dit af te vangen.`, todo: 'korte blik: welke CMP-variant is dit, en doet laag 3 het hier?' };
    case 'language_gap':
      return { outcome: `MOGELIJK NIEUWE TAAL — geen enkele knop matchte een bekende taal${r.languageGapNote ? `; Claude: ${r.languageGapNote}` : ''}. Geen bruikbaar voorstel deze run.`, todo: 'korte blik op de knopteksten' };
    case 'retry':
      return {
        outcome: `NIET GEREPRODUCEERD (poging ${o.attempt}/${RETRY_MAX_ATTEMPTS}) — ${r.classification.reason} Volgende poging over ~${o.nextInHours} u met andere profielen. Dit is géén "vals positief"-oordeel.`,
        todo: 'niets — wachten op de herhaalpoging',
      };
    case 'needs_human':
      return {
        outcome: `JOUW BLIK NODIG — na ${o.attempts} pogingen in verschillende profielen geen banner gezien en geen bruikbare snapshot. Mogelijk geo-afhankelijk, login-afhankelijk of al opgelost door de site.`,
        todo: `site zelf openen (${`https://${r.host}${safePath(r.work.path)}`}) en kijken wat de melder zag`,
      };
    case 'error':
      return { outcome: `FOUT BIJ BEZOEKEN — ${o.message}`, todo: 'alleen bij herhaling: site handmatig checken' };
    default:
      return { outcome: `ONBEKEND — ${o.reason}`, todo: 'korte blik' };
  }
}

async function setOutput(key: string, value: string): Promise<void> {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  const delim = `__bb_${Math.random().toString(36).slice(2)}__`;
  await appendFile(file, `${key}<<${delim}\n${value}\n${delim}\n`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (!process.env.KV_REST_API_URL && !process.env.UPSTASH_REDIS_REST_URL) {
    console.error('Geen Upstash-credentials in env. Stop.');
    process.exit(1);
  }
  const redis = getRedis();
  const rules = await loadRules();

  // Publieke changelog: eerder via PR gemergede voorstellen promoveren.
  const liveKeywords = [
    ...(rules.autoclick?.rejectKeywords ?? []),
    ...(rules.autoclick?.ambiguousKeywords ?? []),
    ...(rules.autoclick?.stepIntoKeywords ?? []),
  ];
  const promotion = await promotePendingFixes(redis, liveKeywords);
  if (promotion.promoted.length) console.log(`/fixed bijgewerkt: ${promotion.promoted.join(', ')}`);

  // Werk verzamelen: nieuwe meldingen, of (retry-modus) de wachtrij.
  let hosts: HostWork[];
  if (RETRY_MODE) {
    const due = await getDueRetries(redis, MAX_HOSTS);
    hosts = due.map((m) => ({ ...m.work, attempt: m.attempts + 1 }));
    console.log(`Retry-modus: ${hosts.length} host(s) aan de beurt`);
  } else {
    hosts = await getHostsToAnalyze(redis, { maxHosts: MAX_HOSTS });
    // Een nieuwe melding over een host in de wachtrij: nu meteen opnieuw,
    // met de verse context, en de wachtrij-teller meenemen.
    for (const h of hosts) {
      const meta = await getRetryMeta(redis, h.hostname);
      if (meta) h.attempt = meta.attempts + 1;
    }
    console.log(`Hosts te analyseren: ${hosts.length}`);
  }

  const noWork = async (msg: string): Promise<void> => {
    await writeFile('summary.md', `${msg}\n`);
    await setOutput('has_proposals', 'false');
    await setOutput('has_hostrules', 'false');
    await setOutput('pr_draft', 'false');
    await setOutput('summary', msg);
  };
  if (!hosts.length) {
    await noWork(RETRY_MODE ? 'Geen herhaalpogingen aan de beurt.' : 'Geen nieuwe meldingen om te analyseren.');
    return;
  }

  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const results: HostResult[] = [];
  const proposals = new Map<string, Proposal>();

  try {
    for (const work of hosts) {
      const attempt = work.attempt ?? 1;
      console.log(`→ ${work.hostname} (${work.reportIds.length} melding(en), poging ${attempt})`);
      // Keywords die op DEZE host al gelden (globaal + hostRules), zodat we
      // niets voorstellen wat al live is.
      setRemoteKeywords(keywordsForHost(rules, work.hostname), work.hostname);

      const result = await analyzeHost(browser, work, attempt);

      // Taalgat → Claude laten kijken (ook op snapshot-bewijs).
      if (
        result.classification.category === 'possible_language_gap' &&
        result.detection &&
        result.detection.candidates.length > 0
      ) {
        try {
          const gap = await proposeLanguageGapKeywords({
            hostname: work.hostname,
            bannerSnippet: result.detection.bannerTextSnippet,
            pageLang: result.detection.pageLang,
            weakSignal: result.detection.weakSignal,
            candidateTexts: result.detection.candidates.map((c) => c.text),
          });
          result.languageGapNote =
            (gap.detectedLanguage ? `taal: ${gap.detectedLanguage} — ` : '') + (gap.note || '(geen toelichting)');
          for (const gp of gap.proposals) {
            const key = `${gp.list}:${gp.keyword}`;
            if (proposals.has(key)) continue;
            proposals.set(key, {
              keyword: gp.keyword,
              list: gp.list,
              buttonText: gp.buttonText,
              bannerSnippet: result.detection.bannerTextSnippet,
              hostname: work.hostname,
              source: result.source === 'snapshot' ? 'snapshot' : 'headless',
              variantWithoutDiacritics: gp.variantWithoutDiacritics,
              fromLanguageGap: true,
            });
          }
        } catch (err) {
          console.warn('[analyze] taalgat-generator faalde:', err);
          result.languageGapNote = 'Claude-taalgat-analyse faalde (technische fout)';
        }
      }

      results.push(result);

      const d = result.detection;
      const cls = result.classification;
      console.log(`   bewijs    : ${result.source}`);
      console.log(`   categorie : ${cls.category}`);
      console.log(`   reden     : ${cls.reason}`);
      if (d) {
        console.log(`   knoppen (${d.candidates.length}): ${d.candidates.map((c) => `"${c.text}"`).join(', ') || '(geen)'}`);
        if (d.bannerTextSnippet) console.log(`   banner-tekst: ${d.bannerTextSnippet.slice(0, 160)}`);
      }
      console.log(`   voorstellen: ${cls.proposals.map((p) => `${p.list}:${p.keyword}`).join(', ') || '(geen)'}`);

      for (const p of cls.proposals) {
        const key = `${p.list}:${p.keyword}`;
        if (proposals.has(key)) continue;
        const cand = d?.candidates.find((c) => normalize(c.text) === p.keyword);
        const buttonText = cand?.text ?? (p.list === 'stepInto' ? result.stepIntoButtonText ?? p.keyword : p.keyword);
        proposals.set(key, {
          keyword: p.keyword,
          list: p.list,
          buttonText,
          bannerSnippet: d?.bannerTextSnippet ?? '',
          hostname: work.hostname,
          source: result.source === 'snapshot' ? 'snapshot' : 'headless',
        });
      }

      await writeAnalysis(redis, work.hostname, {
        hostname: work.hostname,
        category: cls.category,
        reason: cls.reason,
        cmps: cls.cmps,
        proposals: cls.proposals,
        source: result.source,
        attempt,
        visits: result.visits.map((v) => ({ profile: v.profile, url: v.url, status: v.status, bannerVisible: v.bannerVisible, category: v.category, error: v.error })),
        stepIntoButtonText: result.stepIntoButtonText,
        languageGapNote: result.languageGapNote,
        sampleMessage: work.sampleMessage,
        analyzedAt: Date.now(),
      });
      if (!RETRY_MODE) await markAnalyzed(redis, work.reportIds);
    }
  } finally {
    await browser.close();
  }

  // Claude-judge over elk voorstel.
  const judged: JudgedProposal[] = [];
  for (const p of proposals.values()) {
    const judgement = await judgeKeyword({
      keyword: p.keyword,
      buttonText: p.buttonText,
      bannerSnippet: p.bannerSnippet,
      hostname: p.hostname,
      list: p.list,
    });
    console.log(`   judge [${p.list}] "${p.keyword}" (${p.source}) → ${judgement.verdict}/${judgement.confidence}`);
    judged.push({ ...p, judgement });
  }

  // Tiers. approve/high → host-scoped live (uitzondering op fix #1, zie kop).
  const autoLive = judged.filter((j) => isAutoApprove(j.judgement));
  const needsReview = judged.filter((j) => j.judgement.verdict === 'approve' && !isAutoApprove(j.judgement));
  const rejected = judged.filter((j) => j.judgement.verdict === 'reject');

  interface HostRuleEntry { hostname: string; keyword: string; list: KeywordProposal['list']; buttonText: string; reason: string; source: EvidenceSource }
  const hostRuleEntries: HostRuleEntry[] = [];
  for (const p of autoLive) {
    hostRuleEntries.push({ hostname: p.hostname, keyword: p.keyword, list: p.list, buttonText: p.buttonText, reason: p.judgement.reason, source: p.source });
    if (p.variantWithoutDiacritics && p.variantWithoutDiacritics !== p.keyword) {
      hostRuleEntries.push({ hostname: p.hostname, keyword: p.variantWithoutDiacritics, list: p.list, buttonText: p.buttonText, reason: `${p.judgement.reason} (accentloze variant)`, source: p.source });
    }
  }

  interface StageEntry {
    keyword: string; list: KeywordProposal['list']; hostname: string; buttonText: string;
    verdict: Judgement['verdict']; confidence: Judgement['confidence']; reason: string;
    fromLanguageGap: boolean; tier: 'ready' | 'review';
  }
  const stageEntries: StageEntry[] = needsReview.map((p) => ({
    keyword: p.keyword, list: p.list, hostname: p.hostname, buttonText: p.buttonText,
    verdict: p.judgement.verdict, confidence: p.judgement.confidence, reason: p.judgement.reason,
    fromLanguageGap: p.fromLanguageGap ?? false, tier: 'review',
  }));
  // Host-keywords die op ≥2 hosts voorkomen (inclusief wat we nu toevoegen)
  // → globale kandidaat in de PR, hoge-zekerheid-tier.
  {
    const simulated = structuredClone(rules);
    const { mergeHostProposals } = await import('./rules.ts');
    for (const e of hostRuleEntries) mergeHostProposals(simulated, e.hostname, [{ keyword: e.keyword, list: e.list }]);
    for (const g of hostRuleKeywordsSeenOn(simulated, 2)) {
      if (stageEntries.some((s) => s.keyword === g.keyword && s.list === g.list)) continue;
      stageEntries.push({
        keyword: g.keyword, list: g.list, hostname: g.hosts.join(', '), buttonText: g.keyword,
        verdict: 'approve', confidence: 'high',
        reason: `Staat als host-regel op ${g.hosts.length} hosts (${g.hosts.join(', ')}) — kandidaat om globaal te worden.`,
        fromLanguageGap: false, tier: 'ready',
      });
    }
  }

  // Uitkomst per host + statussen + wachtrij.
  const blocks: OwnerHostBlock[] = [];
  let liveCount = 0;
  let reviewCount = 0;
  let humanCount = 0;
  let retryCount = 0;
  for (const r of results) {
    const liveHere = autoLive.filter((p) => p.hostname === r.host);
    const reviewHere = needsReview.filter((p) => p.hostname === r.host);
    const rejectedHere = rejected.filter((p) => p.hostname === r.host);
    let outcome: Outcome;
    if (r.denied) outcome = { kind: 'unknown', reason: r.classification.reason };
    else if (liveHere.length) outcome = { kind: 'live', keywords: liveHere };
    else if (reviewHere.length) outcome = { kind: 'review', keywords: reviewHere };
    else if (rejectedHere.length) outcome = { kind: 'rejected', keywords: rejectedHere };
    else if (r.wallFromTrace || r.classification.category === 'consent_or_pay_wall') outcome = { kind: 'wall' };
    else if (r.classification.category === 'accept_only') outcome = { kind: 'accept_only' };
    else if (r.classification.category === 'cmp_iframe_unreachable') outcome = { kind: 'cmp_iframe' };
    else if (r.classification.category === 'possible_language_gap') outcome = { kind: 'language_gap' };
    else if (r.source === 'none') {
      const attempt = r.work.attempt ?? 1;
      if (r.error && attempt < RETRY_MAX_ATTEMPTS) outcome = { kind: 'retry', attempt, nextInHours: 6 };
      else if (r.error) outcome = { kind: 'error', message: r.error };
      else if (attempt < RETRY_MAX_ATTEMPTS) outcome = { kind: 'retry', attempt, nextInHours: 6 };
      else outcome = { kind: 'needs_human', attempts: attempt };
    } else outcome = { kind: 'unknown', reason: r.classification.reason };

    try {
      switch (outcome.kind) {
        case 'live':
          liveCount++;
          await clearRetry(redis, r.host);
          // fixed-status + /fixed volgen pas ná de push (publish-autofixed.ts).
          break;
        case 'review':
          reviewCount++;
          await setHostStatus(redis, r.host, 'investigating', 'A fix is in review.');
          await clearRetry(redis, r.host);
          break;
        case 'wall':
          await setHostStatus(redis, r.host, 'not-a-bug', 'wall');
          await clearRetry(redis, r.host);
          break;
        case 'accept_only':
          await setHostStatus(redis, r.host, 'not-a-bug', 'accept-only');
          await clearRetry(redis, r.host);
          break;
        case 'retry': {
          retryCount++;
          const tried = r.visits.map((v) => `${v.profile} ${v.url}`);
          await scheduleRetry(redis, r.work, tried);
          await setHostStatus(redis, r.host, 'investigating', 'We could not reproduce this yet and will retry automatically.');
          break;
        }
        case 'needs_human':
          humanCount++;
          await clearRetry(redis, r.host);
          await setHostStatus(redis, r.host, 'investigating', 'Queued for a manual look.');
          break;
        case 'cmp_iframe':
        case 'language_gap':
        case 'unknown':
        case 'rejected':
        case 'error':
          humanCount++;
          await clearRetry(redis, r.host);
          await setHostStatus(redis, r.host, 'investigating', 'Under investigation.');
          break;
      }
    } catch (err) {
      console.warn('[analyze] status/wachtrij bijwerken faalde:', err);
    }

    const described = describeOutcome(outcome, r);
    const reporter = describeReporter(r.work);
    const tried = describeVisits(r);
    let explanation = '';
    try {
      explanation = await explainForOwner({
        hostname: r.host,
        reporterSaw: reporter,
        weTried: tried,
        outcome: described.outcome,
        userMessage: (r.work.sampleMessage ?? '').slice(0, 400),
      });
    } catch {
      explanation = '';
    }
    blocks.push({
      hostname: r.host,
      ticketStatus:
        outcome.kind === 'live' ? 'fixed' : outcome.kind === 'wall' || outcome.kind === 'accept_only' ? 'not-a-bug' : 'investigating',
      reporterSaw: reporter,
      weTried: tried,
      outcome: described.outcome,
      todo: described.todo,
      explanation,
      urgent: outcome.kind === 'needs_human' || outcome.kind === 'review' || outcome.kind === 'cmp_iframe' || outcome.kind === 'language_gap',
    });
  }

  // Mail aan Robin — altijd, maar nu met een onderwerp dat zegt of hij iets moet doen.
  try {
    const sent = await sendOwnerSummaryEmail(blocks, { live: liveCount, review: reviewCount, human: humanCount, retry: retryCount, retryMode: RETRY_MODE });
    console.log(`[analyze] eigenaar-samenvatting verstuurd: ${sent}`);
  } catch (err) {
    console.warn('[analyze] eigenaar-samenvatting faalde:', err);
  }

  // Bestanden voor de workflow-stappen.
  await writeFile('hostrules-to-apply.json', JSON.stringify(hostRuleEntries, null, 2) + '\n');
  await writeFile('proposals-to-stage.json', JSON.stringify(stageEntries, null, 2) + '\n');
  if (stageEntries.length) {
    await recordPendingFix(redis, stageEntries.filter((e) => !e.hostname.includes(',')).map((e) => ({ hostname: e.hostname, keyword: e.keyword, list: e.list })));
  }

  // Samenvatting + PR-body.
  const lines: string[] = ['## BannerBye pijplijn v2 — analyse-run', ''];
  lines.push(`Hosts onderzocht: **${results.length}**${RETRY_MODE ? ' (herhaalpogingen)' : ''}`);
  lines.push(`Live (host-scoped): **${liveCount}** · naar review: **${reviewCount}** · herhaalpoging: **${retryCount}** · menselijke blik: **${humanCount}**`);
  lines.push('');
  for (const b of blocks) {
    lines.push(`### ${b.hostname}`);
    lines.push(`- Melder zag: ${b.reporterSaw}`);
    lines.push(`- Wij probeerden: ${b.weTried}`);
    lines.push(`- Uitkomst: ${b.outcome}`);
    lines.push(`- Te doen: ${b.todo}`);
    lines.push('');
  }
  const summary = lines.join('\n');
  await writeFile('summary.md', summary + '\n');

  if (stageEntries.length) {
    const pr: string[] = ['## BannerBye — keywords naar review', ''];
    pr.push('Host-scoped fixes met hoge zekerheid staan al live op main (zie commit "host-regels"). Hieronder wat jouw oordeel nodig heeft. Nooit auto-merge.', '');
    for (const e of stageEntries) {
      pr.push(`#### \`${e.keyword}\` → \`${e.list}Keywords\` (${e.tier === 'ready' ? 'hoge zekerheid' : 'lagere zekerheid'})`);
      pr.push(`- Site(s): ${e.hostname}`);
      pr.push(`- Originele knop: "${e.buttonText}"`);
      pr.push(`- Claude: **${e.verdict} / ${e.confidence}** — ${e.reason}`);
      pr.push('');
    }
    const prBody = pr.join('\n');
    await writeFile('pr-body.md', prBody + '\n');
    await setOutput('pr_body', prBody);
  }

  const commitMsg =
    `Pijplijn v2: ${stageEntries.length} keyword(s) naar review-PR\n\n` +
    stageEntries.map((p) => `- [${p.tier}] [${p.list}] ${p.keyword} (${p.hostname}): ${p.reason}`).join('\n');
  const hostCommitMsg =
    `Pijplijn v2: ${hostRuleEntries.length} host-regel(s) automatisch toegepast\n\n` +
    hostRuleEntries.map((e) => `- ${e.hostname}: [${e.list}] ${e.keyword} (${e.source}, Claude approve/high) — ${e.reason}`).join('\n');

  await setOutput('has_proposals', stageEntries.length ? 'true' : 'false');
  await setOutput('has_hostrules', hostRuleEntries.length ? 'true' : 'false');
  await setOutput('pr_draft', stageEntries.some((e) => e.tier === 'review') ? 'true' : 'false');
  await setOutput('commit_message', commitMsg);
  await setOutput('hostrules_commit_message', hostCommitMsg);
  await setOutput('summary', summary);
  console.log(`\nKlaar. Live: ${liveCount}. Review: ${reviewCount}. Herhaalpoging: ${retryCount}. Menselijke blik: ${humanCount}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
