/**
 * Phase 2B/2C — main analyzer (incl. accept-only / step-into, #69-73).
 *
 * Draait in GitHub Actions (zie .github/workflows/phase2b-analyze.yml):
 *   1. lees hosts met nog niet onderzochte meldingen uit Redis
 *   2. bezoek elke host met headless Chromium, detecteer de consent-situatie
 *   3. bij "Customize / Accept All" (geen directe reject): klik de step-into
 *      knop en analyseer het geopende paneel (spiegelt de extensie-flow)
 *   3b. bij `possible_language_gap` (v0.4.4): geen enkele knop matcht een
 *       bekende taal — vraag Claude de taal te herkennen en kandidaat-
 *       keywords voor te stellen (proposeLanguageGapKeywords), ipv het aan
 *       een mens over te laten zoals bij coffeeisland.gr (sep 2026)
 *   4. classificeer + Claude beoordeelt elk voorstel (per doellijst) —
 *      óók de taalgat-voorstellen gaan door dezelfde onafhankelijke judge
 *   5. Sinds security-audit 2026-09-16 (bevinding 1): GEEN enkel voorstel
 *      schrijft hier nog direct naar rules.json of pusht naar main — ook
 *      approve+high niet. Alle geoordeelde voorstellen (approve/high +
 *      approve/lager) gaan naar `proposals-to-stage.json`, inclusief een
 *      mechanisch afgeleide accentloze variant bij taalgat-voorstellen met
 *      hoge zekerheid (zie keywords.ts voor de Griekse les). Reject-verdicts
 *      worden niet gestaged, alleen gerapporteerd.
 *   6. de workflow zet die entries op een branch en opent ÉÉN PR die Robin
 *      zelf moet mergen (peter-evans/create-pull-request, nooit auto-merge);
 *      markeer reports analyzed
 *   7. #134 — stuur Robin altijd een samenvattingsmail: per host wat de
 *      uitkomst was (voorstel klaar om te mergen / naar review / afgewezen /
 *      vals positief / accept-only / mogelijk nieuwe taal / technische fout).
 *      Best-effort, faalt nooit de run.
 *
 * Env: KV_REST_API_URL/TOKEN (verplicht), ANTHROPIC_API_KEY,
 *      MAX_HOSTS (25), NAV_TIMEOUT_MS (20000), WAIT_MS (3500),
 *      PANEL_WAIT_MS (1800), RULES_FILE.
 */

import { appendFile, writeFile } from 'node:fs/promises';
import { chromium, type Browser } from 'playwright';
import { setRemoteKeywords, normalize } from '../../src/lib/autoclick/keywords.ts';
import {
  getRedis,
  getHostsToAnalyze,
  markAnalyzed,
  writeAnalysis,
  type HostWork,
} from './redis.ts';
import { sendOwnerSummaryEmail } from './notify.ts';
import { detectInPage, type DetectionResult } from './detect.ts';
import {
  classify,
  classifyStepPanel,
  type Classification,
  type KeywordProposal,
} from './classify.ts';
import { loadRules } from './rules.ts';
import {
  judgeKeyword,
  isAutoApprove,
  proposeLanguageGapKeywords,
  type Judgement,
} from './claude.ts';

interface Proposal extends KeywordProposal {
  buttonText: string;
  bannerSnippet: string;
  hostname: string;
  /**
   * v0.4.4: alleen gezet voor taalgat-voorstellen waar Claude een
   * accentloze variant meegaf (zie keywords.ts, de Griekse les). Wordt na
   * een approve+high judgement mechanisch mee toegevoegd — geen aparte
   * judge-call nodig, het is dezelfde betekenis als het geoordeelde keyword.
   */
  variantWithoutDiacritics?: string;
  /** v0.4.4: markeert dat dit voorstel via de taalgat-generator kwam, voor logging/mail. */
  fromLanguageGap?: boolean;
}
interface JudgedProposal extends Proposal {
  judgement: Judgement;
}
interface HostResult {
  host: string;
  classification: Classification;
  detection: DetectionResult | null;
  stepIntoButtonText?: string;
  error?: string;
  /** v0.4.4: Claude's oordeel of/welke taal er bij een taalgat herkend is — voor de samenvattingsmail. */
  languageGapNote?: string;
}

const MAX_HOSTS = Number(process.env.MAX_HOSTS ?? '25');
const NAV_TIMEOUT_MS = Number(process.env.NAV_TIMEOUT_MS ?? '20000');
const WAIT_MS = Number(process.env.WAIT_MS ?? '3500');
const PANEL_WAIT_MS = Number(process.env.PANEL_WAIT_MS ?? '1800');

const CLICKABLE = 'button, [role="button"], a, input[type="button"], input[type="submit"]';

/**
 * v0.4.5 (fix #4, security-audit 2026-09-16) — SSRF-denylist, defense-in-
 * depth. api/report.ts (bannerbye-landing) blokkeert dit al bij de submit,
 * maar deze job draait met veel machtigere secrets in zijn environment
 * (ANTHROPIC_API_KEY, LANDING_REPO_TOKEN met push-rechten, KV_REST_API_TOKEN)
 * dan de report-endpoint — een tweede check hier, vlak vóór het daadwerkelijke
 * bezoek, is goedkoop en vangt ook hosts op die via een ouder rapport (van
 * vóór de report.ts-fix) nog in Redis staan. Zelfde bekende beperking als
 * daar: dit is een check op de letterlijke hostname-string, geen DNS-
 * rebinding-bescherming.
 */
const DENIED_EXACT_HOSTS = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'broadcasthost',
  'metadata',
  'metadata.google.internal',
  'metadata.internal',
]);

function isDeniedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (DENIED_EXACT_HOSTS.has(h)) return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a > 255 || b > 255 || Number(m[3]) > 255 || Number(m[4]) > 255) return true;
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 10) return true; // 10.0.0.0/8 private
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
    if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  }
  return false;
}

async function analyzeHost(
  browser: Browser,
  work: HostWork,
): Promise<HostResult> {
  const host = work.hostname;

  if (isDeniedHostname(host)) {
    return {
      host,
      detection: null,
      classification: {
        category: 'unknown',
        proposals: [],
        reason: 'Hostname staat op de SSRF-denylist (loopback/private/metadata) — niet bezocht.',
        cmps: [],
      },
    };
  }

  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    locale: 'nl-NL',
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  try {
    await page.goto(`https://${host}`, {
      waitUntil: 'domcontentloaded',
      timeout: NAV_TIMEOUT_MS,
    });
    await page.waitForTimeout(WAIT_MS);
    const detection = (await page.evaluate(detectInPage)) as DetectionResult;
    const classification = classify(detection);

    // Fase 2: geen directe reject, wél een step-into knop → klik + heranalyseer.
    if (
      classification.category === 'needs_step_into' &&
      classification.stepIntoButtonText
    ) {
      const btn = classification.stepIntoButtonText;
      try {
        await page
          .locator(CLICKABLE, { hasText: btn })
          .first()
          .click({ timeout: 3000 });
        await page.waitForTimeout(PANEL_WAIT_MS);
        const panel = (await page.evaluate(detectInPage)) as DetectionResult;
        const panelClass = classifyStepPanel(panel, btn, detection.cmps);
        return {
          host,
          classification: panelClass,
          detection: panel,
          stepIntoButtonText: btn,
        };
      } catch (err) {
        return {
          host,
          detection,
          stepIntoButtonText: btn,
          classification: {
            category: 'unknown',
            proposals: [],
            reason: `Step-into knop "${btn}" gevonden maar klikken/heranalyseren faalde: ${
              err instanceof Error ? err.message : String(err)
            }`,
            cmps: detection.cmps,
          },
        };
      }
    }

    return { host, classification, detection };
  } catch (err) {
    return {
      host,
      detection: null,
      classification: {
        category: 'unknown',
        proposals: [],
        reason: `Kon de site niet laden/analyseren: ${
          err instanceof Error ? err.message : String(err)
        }`,
        cmps: [],
      },
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await context.close();
  }
}

function buildSummary(
  results: HostResult[],
  readyToMerge: JudgedProposal[],
  needsExtraReview: JudgedProposal[],
  rejectedByClaude: JudgedProposal[],
): string {
  const fmt = (p: JudgedProposal): string =>
    `- \`${p.keyword}\` [${p.list}]${p.fromLanguageGap ? ' 🌐' : ''} — ${p.hostname} · Claude: ${p.judgement.verdict}/${p.judgement.confidence} · ${p.judgement.reason}`;
  const lines: string[] = [];
  lines.push('## BannerBye Phase 2C — analyse-run');
  lines.push('');
  lines.push(`Hosts onderzocht: **${results.length}**`);
  lines.push('');
  lines.push(
    '⚠️ Sinds de fix van bevinding 1 (security-audit 2026-09-16) gaat niets meer automatisch live. Alles hieronder staat in de PR en wacht op een handmatige merge door Robin.',
  );
  lines.push('');
  lines.push(`### ✅ Hoge zekerheid — klaar om te mergen (${readyToMerge.length})`);
  lines.push(readyToMerge.length ? readyToMerge.map(fmt).join('\n') : '_Niets met hoge zekerheid deze run._');
  lines.push('');
  lines.push(`### 🕵️ Lagere zekerheid — extra aandacht nodig (${needsExtraReview.length})`);
  lines.push(needsExtraReview.length ? needsExtraReview.map(fmt).join('\n') : '_Geen randgevallen deze run._');
  lines.push('');
  lines.push(`### ❌ Afgewezen door Claude — niet gestaged (${rejectedByClaude.length})`);
  lines.push(rejectedByClaude.length ? rejectedByClaude.map(fmt).join('\n') : '_Niets afgewezen deze run._');
  lines.push('');
  lines.push('_🌐 = via de taalgat-generator (v0.4.4) — een taal die nog niet in de keyword-lijsten zat._');
  lines.push('');
  return lines.join('\n');
}

function buildPrBody(
  readyToMerge: JudgedProposal[],
  needsExtraReview: JudgedProposal[],
): string {
  const fmtEntry = (p: JudgedProposal): string[] => [
    `#### \`${p.keyword}\` → \`${p.list}Keywords\`${p.fromLanguageGap ? ' (taalgat-voorstel)' : ''}`,
    `- Site: ${p.hostname}`,
    `- Originele knop: "${p.buttonText}"`,
    `- Claude: **${p.judgement.verdict} / ${p.judgement.confidence}** — ${p.judgement.reason}`,
    '',
  ];
  const lines: string[] = [];
  lines.push('## BannerBye Phase 2C — keywords naar review');
  lines.push('');
  lines.push(
    'Sinds de fix van security-bevinding 1 (2026-09-16) past niets zich meer automatisch toe — élk voorstel loopt via deze PR. Merge zelf, na een korte blik. Nooit auto-merge.',
  );
  lines.push('');
  if (readyToMerge.length) {
    lines.push(`### ✅ Hoge zekerheid — Claude keurde dit approve/high goed (${readyToMerge.length})`);
    lines.push('');
    readyToMerge.forEach((p) => lines.push(...fmtEntry(p)));
  }
  if (needsExtraReview.length) {
    lines.push(`### 🕵️ Lagere zekerheid — extra aandacht nodig (${needsExtraReview.length})`);
    lines.push('');
    needsExtraReview.forEach((p) => lines.push(...fmtEntry(p)));
  }
  return lines.join('\n');
}

/**
 * #134 — één leesbare regel per onderzochte host voor de eigenaar-mail.
 * Vertaalt de classificatie-categorie + het judge-resultaat naar een
 * ondubbelzinnige uitkomst, inclusief het "vals positief"-geval
 * (`no_banner`: geen banner meer gevonden — waarschijnlijk al opgelost of
 * niet reproduceerbaar bij de melder, zoals bij het ikea.com-onderzoek van
 * 2 sep) en (v0.4.4) het "mogelijk nieuwe taal"-geval.
 */
function describeHostOutcome(
  r: HostResult,
  readyToMerge: JudgedProposal[],
  needsExtraReview: JudgedProposal[],
  rejectedByClaude: JudgedProposal[],
): string {
  const readyHere = readyToMerge.filter((p) => p.hostname === r.host);
  const reviewHere = needsExtraReview.filter((p) => p.hostname === r.host);
  const rejectedHere = rejectedByClaude.filter((p) => p.hostname === r.host);

  if (r.error) {
    return `- ${r.host}: FOUT bij bezoeken — ${r.error}`;
  }
  if (readyHere.length) {
    const kws = readyHere.map((p) => `"${p.keyword}"${p.fromLanguageGap ? ' [nieuwe taal]' : ''} [${p.list}]`).join(', ');
    return `- ${r.host}: VOORSTEL KLAAR OM TE MERGEN — hoge zekerheid, staat in de review-PR (${kws})`;
  }
  if (reviewHere.length) {
    const details = reviewHere
      .map((p) => `"${p.keyword}": ${p.judgement.reason}`)
      .join('; ');
    return `- ${r.host}: NAAR REVIEW — voorstel gevonden maar niet met hoge zekerheid (${details}) — staat in de PR`;
  }
  if (rejectedHere.length) {
    const details = rejectedHere
      .map((p) => `"${p.keyword}": ${p.judgement.reason}`)
      .join('; ');
    return `- ${r.host}: VOORSTEL AFGEWEZEN DOOR CLAUDE — niet gestaged (${details})`;
  }
  if (r.classification.category === 'possible_language_gap') {
    return `- ${r.host}: MOGELIJK NIEUWE TAAL — geen bekende taal/indicator matchte een knop${
      r.languageGapNote ? `; Claude: ${r.languageGapNote}` : ''
    } — geen bruikbaar voorstel deze run, handmatige blik aanbevolen`;
  }
  if (r.classification.category === 'no_banner') {
    return `- ${r.host}: GEEN BANNER GEVONDEN — waarschijnlijk vals positief of al opgelost (niet reproduceerbaar bij deze run)`;
  }
  if (r.classification.category === 'accept_only') {
    return `- ${r.host}: ACCEPT-ONLY — geen weiger-optie op de site zelf, niet oplosbaar via klikken (geen bug)`;
  }
  return `- ${r.host}: ONBEKEND — ${r.classification.reason}`;
}

async function setOutput(key: string, value: string): Promise<void> {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  const delim = `__bb_${Math.random().toString(36).slice(2)}__`;
  await appendFile(file, `${key}<<${delim}\n${value}\n${delim}\n`);
}

async function main(): Promise<void> {
  if (!process.env.KV_REST_API_URL && !process.env.UPSTASH_REDIS_REST_URL) {
    console.error('Geen Upstash-credentials in env. Stop.');
    process.exit(1);
  }
  const redis = getRedis();
  const hosts = await getHostsToAnalyze(redis, { maxHosts: MAX_HOSTS });
  console.log(`Hosts te analyseren: ${hosts.length}`);

  const rules = await loadRules();
  setRemoteKeywords({
    rejectKeywords: rules.autoclick?.rejectKeywords ?? [],
    ambiguousKeywords: rules.autoclick?.ambiguousKeywords ?? [],
    stepIntoKeywords: rules.autoclick?.stepIntoKeywords ?? [],
  });

  if (!hosts.length) {
    await writeFile('summary.md', 'Geen nieuwe meldingen om te analyseren.\n');
    await setOutput('has_proposals', 'false');
    await setOutput('pr_draft', 'false');
    await setOutput('summary', 'Geen nieuwe meldingen om te analyseren.');
    return;
  }

  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const results: HostResult[] = [];
  const proposals = new Map<string, Proposal>();

  try {
    for (const work of hosts) {
      console.log(`→ ${work.hostname} (${work.reportIds.length} meldingen)`);
      const result = await analyzeHost(browser, work);

      // v0.4.4: taalgat — geen enkele knop matchte een bekende taal/indicator.
      // Vraag Claude de taal te herkennen en (indien het écht een consent-
      // banner is) kandidaat-keywords voor te stellen. Deze voorstellen gaan
      // via dezelfde `proposals`-Map hieronder door de bestaande, onafhankelijke
      // judge-stap — geen apart auto-apply-pad, geen verlaagde lat.
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
          console.log(
            `   taalgat   : ${gap.isConsentBanner ? 'consent-banner bevestigd' : 'GEEN consent-banner (Claude)'} · ${result.languageGapNote}`,
          );
          for (const gp of gap.proposals) {
            const key = `${gp.list}:${gp.keyword}`;
            if (proposals.has(key)) continue;
            proposals.set(key, {
              keyword: gp.keyword,
              list: gp.list,
              buttonText: gp.buttonText,
              bannerSnippet: result.detection.bannerTextSnippet,
              hostname: work.hostname,
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

      // --- Diagnose-logging: precies wat de analyzer op deze host zag. ---
      const d = result.detection;
      const cls = result.classification;
      console.log(`   categorie : ${cls.category}`);
      console.log(`   reden     : ${cls.reason}`);
      console.log(
        `   banner    : ${d ? (d.bannerVisible ? 'zichtbaar' : 'NIET gevonden') : 'geen detectie'}` +
          ` · TCF: ${d?.hasTcf ? 'ja' : 'nee'} · CMP: [${(cls.cmps ?? []).join(', ') || '-'}]` +
          `${d?.weakSignal ? ' · zwak vormsignaal' : ''}`,
      );
      if (d) console.log(`   eind-URL  : ${d.finalUrl}`);
      if (result.stepIntoButtonText)
        console.log(`   step-into : "${result.stepIntoButtonText}"`);
      const cand = d?.candidates ?? [];
      console.log(
        `   knoppen (${cand.length}): ${
          cand.map((c) => `"${c.text}"`).join(', ') || '(geen)'
        }`,
      );
      if (d?.bannerTextSnippet)
        console.log(`   banner-tekst: ${d.bannerTextSnippet.slice(0, 160)}`);
      console.log(
        `   voorstellen: ${
          cls.proposals.map((p) => `${p.list}:${p.keyword}`).join(', ') || '(geen)'
        }`,
      );

      for (const p of result.classification.proposals) {
        const key = `${p.list}:${p.keyword}`;
        if (proposals.has(key)) continue;
        const cand = result.detection?.candidates.find(
          (c) => normalize(c.text) === p.keyword,
        );
        const buttonText =
          cand?.text ??
          (p.list === 'stepInto' ? result.stepIntoButtonText ?? p.keyword : p.keyword);
        proposals.set(key, {
          keyword: p.keyword,
          list: p.list,
          buttonText,
          bannerSnippet: result.detection?.bannerTextSnippet ?? '',
          hostname: work.hostname,
        });
      }

      await writeAnalysis(redis, work.hostname, {
        hostname: work.hostname,
        category: result.classification.category,
        reason: result.classification.reason,
        cmps: result.classification.cmps,
        proposals: result.classification.proposals,
        stepIntoButtonText: result.stepIntoButtonText,
        languageGapNote: result.languageGapNote,
        sampleMessage: work.sampleMessage,
        analyzedAt: Date.now(),
      });
      await markAnalyzed(redis, work.reportIds);
    }
  } finally {
    await browser.close();
  }

  const judged: JudgedProposal[] = [];
  for (const p of proposals.values()) {
    const judgement = await judgeKeyword({
      keyword: p.keyword,
      buttonText: p.buttonText,
      bannerSnippet: p.bannerSnippet,
      hostname: p.hostname,
      list: p.list,
    });
    console.log(
      `   judge [${p.list}]${p.fromLanguageGap ? ' 🌐' : ''} "${p.keyword}" → ${judgement.verdict}/${judgement.confidence}`,
    );
    judged.push({ ...p, judgement });
  }
  // Bevinding 1 (security-audit 2026-09-16): geen enkel pad meer dat direct
  // naar rules.json schrijft en naar main pusht. ALLE geoordeelde voorstellen
  // — ook approve/high — lopen voortaan via één PR die Robin zelf moet
  // mergen (zie workflow: geen "Auto-apply"-step meer, altijd create-pull-request).
  const readyToMerge = judged.filter((j) => isAutoApprove(j.judgement));
  const needsExtraReview = judged.filter(
    (j) => j.judgement.verdict === 'approve' && !isAutoApprove(j.judgement),
  );
  const rejectedByClaude = judged.filter((j) => j.judgement.verdict === 'reject');

  // v0.4.4: voor readyToMerge-taalgat-voorstellen mét een accentloze variant,
  // voeg die variant mechanisch toe — geen aparte judge-call nodig, het is
  // exact hetzelfde keyword zonder diakritische tekens (dezelfde reden
  // waarom coffeeisland.gr's Griekse fix beide vormen nodig had, zie
  // keywords.ts). Alleen voor de hoge-zekerheid-tier; nooit een NIEUW,
  // onbeoordeeld keyword.
  interface StageEntry {
    keyword: string;
    list: KeywordProposal['list'];
    hostname: string;
    buttonText: string;
    verdict: Judgement['verdict'];
    confidence: Judgement['confidence'];
    reason: string;
    fromLanguageGap: boolean;
    tier: 'ready' | 'review';
  }
  const stageEntries: StageEntry[] = [];
  for (const p of readyToMerge) {
    stageEntries.push({
      keyword: p.keyword,
      list: p.list,
      hostname: p.hostname,
      buttonText: p.buttonText,
      verdict: p.judgement.verdict,
      confidence: p.judgement.confidence,
      reason: p.judgement.reason,
      fromLanguageGap: p.fromLanguageGap ?? false,
      tier: 'ready',
    });
    if (p.variantWithoutDiacritics && p.variantWithoutDiacritics !== p.keyword) {
      stageEntries.push({
        keyword: p.variantWithoutDiacritics,
        list: p.list,
        hostname: p.hostname,
        buttonText: p.buttonText,
        verdict: p.judgement.verdict,
        confidence: p.judgement.confidence,
        reason: `${p.judgement.reason} (accentloze variant, mechanisch afgeleid)`,
        fromLanguageGap: p.fromLanguageGap ?? false,
        tier: 'ready',
      });
    }
  }
  for (const p of needsExtraReview) {
    stageEntries.push({
      keyword: p.keyword,
      list: p.list,
      hostname: p.hostname,
      buttonText: p.buttonText,
      verdict: p.judgement.verdict,
      confidence: p.judgement.confidence,
      reason: p.judgement.reason,
      fromLanguageGap: p.fromLanguageGap ?? false,
      tier: 'review',
    });
  }

  // #reward-2/#reward-3 ("nu opgelost"-mail + publieke /fixed-changelog) zijn
  // hier bewust VERWIJDERD: die gingen ervan uit dat saveRules() de wijziging
  // al live had gezet. Dat klopt met deze fix niet meer — niets is live vóór
  // Robin de PR merget. Een latere iteratie kan dit opnieuw aansluiten op een
  // "PR gemerged"-webhook/workflow; buiten scope van deze security-fix
  // (zie BannerBye_Security-Audit_2026-09-16_INTERN.md, bevinding 1).

  // #134 — samenvattingsmail naar de eigenaar, altijd, ongeacht uitkomst.
  // Best-effort: een mislukte mail mag de rest van de run nooit blokkeren.
  try {
    const ownerLines = results.map((r) =>
      describeHostOutcome(r, readyToMerge, needsExtraReview, rejectedByClaude),
    );
    const sent = await sendOwnerSummaryEmail(ownerLines, readyToMerge.length, needsExtraReview.length);
    console.log(`[analyze] eigenaar-samenvatting verstuurd: ${sent}`);
  } catch (err) {
    console.warn('[analyze] eigenaar-samenvatting faalde:', err);
  }

  await writeFile(
    'proposals-to-stage.json',
    JSON.stringify(stageEntries, null, 2) + '\n',
  );
  if (stageEntries.length) {
    const prBody = buildPrBody(readyToMerge, needsExtraReview);
    await writeFile('pr-body.md', prBody + '\n');
    await setOutput('pr_body', prBody);
  }

  const summary = buildSummary(results, readyToMerge, needsExtraReview, rejectedByClaude);
  await writeFile('summary.md', summary + '\n');

  const commitMsg =
    `Phase 2C: ${stageEntries.length} keyword(s) naar review-PR\n\n` +
    stageEntries
      .map((p) => `- [${p.tier}] [${p.list}] ${p.keyword}${p.fromLanguageGap ? ' (nieuwe taal)' : ''} (${p.hostname}): ${p.reason}`)
      .join('\n');

  await setOutput('has_proposals', stageEntries.length ? 'true' : 'false');
  // Draft blijft aan zodra er ook maar één lagere-zekerheid-voorstel bij zit —
  // dan moet Robin eerst expliciet "Ready for review" klikken vóór hij kan
  // mergen. Bevat de PR uitsluitend hoge-zekerheid-voorstellen, dan hoeft dat
  // niet: mergen blijft sowieso Robin's eigen, bewuste actie.
  await setOutput('pr_draft', needsExtraReview.length ? 'true' : 'false');
  await setOutput('commit_message', commitMsg);
  await setOutput('summary', summary);
  console.log(
    `\nKlaar. Klaar om te mergen: ${readyToMerge.length}. Extra review nodig: ${needsExtraReview.length}. Afgewezen: ${rejectedByClaude.length}.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
