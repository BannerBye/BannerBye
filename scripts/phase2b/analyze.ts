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
import { setRemoteKeywords } from '../../src/lib/autoclick/keywords.ts';
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
  addedKeywords: string[],
): string {
  const byCat: Record<string, HostResult[]> = {};
  for (const r of results) {
    (byCat[r.classification.category] ??= []).push(r);
  }
  const lines: string[] = [];
  lines.push('## BannerBye Phase 2B — analyse-run');
  lines.push('');
  lines.push(`Hosts onderzocht: **${results.length}**`);
  lines.push('');
  if (addedKeywords.length) {
    lines.push(`### Voorgestelde reject-keywords (${addedKeywords.length})`);
    addedKeywords.forEach((k) => lines.push(`- \`${k}\``));
    lines.push('');
  } else {
    lines.push('_Geen nieuwe keyword-voorstellen deze run._');
    lines.push('');
  }
  for (const cat of Object.keys(byCat)) {
    lines.push(`### ${cat} (${byCat[cat].length})`);
    for (const r of byCat[cat]) {
      const cmps = r.classification.cmps.length
        ? ` · CMP: ${r.classification.cmps.join(', ')}`
        : '';
      const kws = r.classification.proposedKeywords.length
        ? ` · → ${r.classification.proposedKeywords.map((k) => `\`${k}\``).join(', ')}`
        : '';
      lines.push(`- **${r.host}**${cmps} — ${r.classification.reason}${kws}`);
    }
    lines.push('');
  }
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
  const allProposed: string[] = [];

  try {
    for (const work of hosts) {
      console.log(`→ ${work.hostname} (${work.reportIds.length} meldingen)`);
      const result = await analyzeHost(browser, work);
      results.push(result);
      allProposed.push(...result.classification.proposedKeywords);

      // Bewaar analyse + markeer meldingen onderzocht (idempotent).
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

  // Merge keyword-voorstellen in rules.json.
  const { added } = mergeRejectKeywords(rules, allProposed);
  if (added.length) {
    await saveRules(rules);
  }

  const summary = buildSummary(results, added);
  await writeFile('summary.md', summary + '\n');
  await setOutput('changed', added.length ? 'true' : 'false');
  await setOutput('summary', summary);
  console.log(`\nKlaar. Nieuwe keywords: ${added.length}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
