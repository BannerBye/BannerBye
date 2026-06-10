/**
 * Phase 2B — main analyzer.
 *
 * Draait in GitHub Actions (zie .github/workflows/phase2b-analyze.yml):
 *   1. lees hosts met nog niet onderzochte meldingen uit Redis
 *   2. bezoek elke host met headless Chromium, detecteer de consent-situatie
 *   3. classificeer (hergebruikt extensie-keyword-logica)
 *   4. markeer reports analyzed + bewaar per-host analyse in Redis
 *   5. merge voorgestelde keywords in repo/rules.json
 *   6. schrijf summary.md + zet GITHUB_OUTPUT changed=true/false
 *
 * De workflow opent daarna een DRAFT-PR als rules.json gewijzigd is.
 *
 * Env:
 *   KV_REST_API_URL, KV_REST_API_TOKEN   (Upstash, verplicht)
 *   MAX_HOSTS        (default 25)
 *   NAV_TIMEOUT_MS   (default 20000)
 *   WAIT_MS          (default 3500)
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
import { detectInPage, type DetectionResult } from './detect.ts';
import { classify, type Classification } from './classify.ts';
import { loadRules, mergeRejectKeywords, saveRules } from './rules.ts';
import { judgeKeyword, isAutoApprove, type Judgement } from './claude.ts';

/** Een voorgesteld keyword met de context die de judge nodig heeft. */
interface Proposal {
  keyword: string;
  buttonText: string;
  bannerSnippet: string;
  hostname: string;
}

interface JudgedProposal extends Proposal {
  judgement: Judgement;
}

interface HostResult {
  host: string;
  classification: Classification;
  detection: DetectionResult | null;
  error?: string;
}

const MAX_HOSTS = Number(process.env.MAX_HOSTS ?? '25');
const NAV_TIMEOUT_MS = Number(process.env.NAV_TIMEOUT_MS ?? '20000');
const WAIT_MS = Number(process.env.WAIT_MS ?? '3500');

async function analyzeHost(
  browser: Browser,
  work: HostWork,
): Promise<HostResult> {
  const host = work.hostname;
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
    return { host, classification, detection };
  } catch (err) {
    return {
      host,
      detection: null,
      classification: {
        category: 'unknown',
        proposedKeywords: [],
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
  applied: JudgedProposal[],
  needsReview: JudgedProposal[],
): string {
  const lines: string[] = [];
  lines.push('## BannerBye Phase 2C — analyse-run');
  lines.push('');
  lines.push(`Hosts onderzocht: **${results.length}**`);
  lines.push('');
  lines.push(`### ✅ Automatisch toegepast (${applied.length})`);
  if (applied.length) {
    applied.forEach((p) =>
      lines.push(
        `- \`${p.keyword}\` — ${p.hostname} · Claude: ${p.judgement.confidence} · ${p.judgement.reason}`,
      ),
    );
  } else {
    lines.push('_Niets automatisch toegepast deze run._');
  }
  lines.push('');
  lines.push(`### 🕵️ Naar review (${needsReview.length})`);
  if (needsReview.length) {
    needsReview.forEach((p) =>
      lines.push(
        `- \`${p.keyword}\` — ${p.hostname} · Claude: ${p.judgement.verdict}/${p.judgement.confidence} · ${p.judgement.reason}`,
      ),
    );
  } else {
    lines.push('_Geen randgevallen deze run._');
  }
  lines.push('');
  return lines.join('\n');
}

/** PR-body voor de needs-review draft-PR. */
function buildPrBody(needsReview: JudgedProposal[]): string {
  const lines: string[] = [];
  lines.push('## BannerBye Phase 2C — keywords naar review');
  lines.push('');
  lines.push(
    'Deze keywords kwamen uit de site-analyse maar Claude keurde ze **niet met hoge zekerheid** goed — daarom geen auto-apply. Beoordeel handmatig en merge als je akkoord bent.',
  );
  lines.push('');
  needsReview.forEach((p) => {
    lines.push(`### \`${p.keyword}\``);
    lines.push(`- Site: ${p.hostname}`);
    lines.push(`- Originele knop: "${p.buttonText}"`);
    lines.push(
      `- Claude: **${p.judgement.verdict} / ${p.judgement.confidence}** — ${p.judgement.reason}`,
    );
    lines.push('');
  });
  return lines.join('\n');
}

async function setOutput(key: string, value: string): Promise<void> {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  // Multiline-safe via heredoc-syntax.
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

  // Laad huidige rules zodat reeds-voorgestelde keywords meetellen als gematcht.
  const rules = await loadRules();
  setRemoteKeywords({
    rejectKeywords: rules.autoclick?.rejectKeywords ?? [],
    ambiguousKeywords: rules.autoclick?.ambiguousKeywords ?? [],
    stepIntoKeywords: rules.autoclick?.stepIntoKeywords ?? [],
  });

  if (!hosts.length) {
    await writeFile('summary.md', 'Geen nieuwe meldingen om te analyseren.\n');
    await setOutput('changed', 'false');
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
      results.push(result);

      // Verzamel voorstellen mét context (knop-tekst + banner) voor de judge.
      for (const kw of result.classification.proposedKeywords) {
        if (proposals.has(kw)) continue;
        const cand = result.detection?.candidates.find(
          (c) => normalize(c.text) === kw,
        );
        proposals.set(kw, {
          keyword: kw,
          buttonText: cand?.text ?? kw,
          bannerSnippet: result.detection?.bannerTextSnippet ?? '',
          hostname: work.hostname,
        });
      }

      await writeAnalysis(redis, work.hostname, {
        hostname: work.hostname,
        category: result.classification.category,
        reason: result.classification.reason,
        cmps: result.classification.cmps,
        proposedKeywords: result.classification.proposedKeywords,
        sampleMessage: work.sampleMessage,
        analyzedAt: Date.now(),
      });
      await markAnalyzed(redis, work.reportIds);
    }
  } finally {
    await browser.close();
  }

  // Claude beoordeelt elk voorstel; alleen approve+high mag auto-live.
  const judged: JudgedProposal[] = [];
  for (const p of proposals.values()) {
    const judgement = await judgeKeyword(p);
    console.log(
      `   judge "${p.keyword}" → ${judgement.verdict}/${judgement.confidence}`,
    );
    judged.push({ ...p, judgement });
  }
  const applied = judged.filter((j) => isAutoApprove(j.judgement));
  const needsReview = judged.filter((j) => !isAutoApprove(j.judgement));

  // Approved-high → toepassen op rules.json (de landing-checkout) voor auto-deploy.
  const { added } = mergeRejectKeywords(
    rules,
    applied.map((p) => p.keyword),
  );
  if (added.length) await saveRules(rules);

  // Needs-review → apart bestand + PR-body voor de draft-PR-stap.
  await writeFile(
    'needs-review.json',
    JSON.stringify(
      needsReview.map((p) => ({
        keyword: p.keyword,
        hostname: p.hostname,
        buttonText: p.buttonText,
        verdict: p.judgement.verdict,
        confidence: p.judgement.confidence,
        reason: p.judgement.reason,
      })),
      null,
      2,
    ) + '\n',
  );
  if (needsReview.length) {
    const prBody = buildPrBody(needsReview);
    await writeFile('pr-body.md', prBody + '\n');
    await setOutput('pr_body', prBody);
  }

  const summary = buildSummary(results, applied, needsReview);
  await writeFile('summary.md', summary + '\n');

  const commitMsg =
    `Phase 2C: ${added.length} keyword(s) auto-toegepast\n\n` +
    applied
      .map((p) => `- ${p.keyword} (${p.hostname}): ${p.judgement.reason}`)
      .join('\n');

  await setOutput('applied', added.length ? 'true' : 'false');
  await setOutput('needs_review', needsReview.length ? 'true' : 'false');
  await setOutput('commit_message', commitMsg);
  await setOutput('summary', summary);
  console.log(
    `\nKlaar. Auto-toegepast: ${added.length}. Naar review: ${needsReview.length}.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
