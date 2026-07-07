/**
 * Phase 2B/2C — main analyzer (incl. accept-only / step-into, #69-73).
 *
 * Draait in GitHub Actions (zie .github/workflows/phase2b-analyze.yml):
 *   1. lees hosts met nog niet onderzochte meldingen uit Redis
 *   2. bezoek elke host met headless Chromium, detecteer de consent-situatie
 *   3. bij "Customize / Accept All" (geen directe reject): klik de step-into
 *      knop en analyseer het geopende paneel (spiegelt de extensie-flow)
 *   4. classificeer + Claude beoordeelt elk voorstel (per doellijst)
 *   5. approve+high → toepassen op rules.json (reject/ambiguous/stepInto)
 *   6. rest → needs-review draft-PR; markeer reports analyzed
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
  recordFixed,
  getWatchers,
  clearWatchers,
  type HostWork,
} from './redis.ts';
import { sendFixedEmail } from './notify.ts';
import { detectInPage, type DetectionResult } from './detect.ts';
import {
  classify,
  classifyStepPanel,
  type Classification,
  type KeywordProposal,
} from './classify.ts';
import { loadRules, mergeProposals, saveRules } from './rules.ts';
import { judgeKeyword, isAutoApprove, type Judgement } from './claude.ts';

interface Proposal extends KeywordProposal {
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
  stepIntoButtonText?: string;
  error?: string;
}

const MAX_HOSTS = Number(process.env.MAX_HOSTS ?? '25');
const NAV_TIMEOUT_MS = Number(process.env.NAV_TIMEOUT_MS ?? '20000');
const WAIT_MS = Number(process.env.WAIT_MS ?? '3500');
const PANEL_WAIT_MS = Number(process.env.PANEL_WAIT_MS ?? '1800');

const CLICKABLE = 'button, [role="button"], a, input[type="button"], input[type="submit"]';

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
  applied: JudgedProposal[],
  needsReview: JudgedProposal[],
): string {
  const fmt = (p: JudgedProposal): string =>
    `- \`${p.keyword}\` [${p.list}] — ${p.hostname} · Claude: ${p.judgement.verdict}/${p.judgement.confidence} · ${p.judgement.reason}`;
  const lines: string[] = [];
  lines.push('## BannerBye Phase 2C — analyse-run');
  lines.push('');
  lines.push(`Hosts onderzocht: **${results.length}**`);
  lines.push('');
  lines.push(`### ✅ Automatisch toegepast (${applied.length})`);
  lines.push(applied.length ? applied.map(fmt).join('\n') : '_Niets automatisch toegepast deze run._');
  lines.push('');
  lines.push(`### 🕵️ Naar review (${needsReview.length})`);
  lines.push(needsReview.length ? needsReview.map(fmt).join('\n') : '_Geen randgevallen deze run._');
  lines.push('');
  return lines.join('\n');
}

function buildPrBody(needsReview: JudgedProposal[]): string {
  const lines: string[] = [];
  lines.push('## BannerBye Phase 2C — keywords naar review');
  lines.push('');
  lines.push(
    'Deze keywords kwamen uit de site-analyse maar Claude keurde ze **niet met hoge zekerheid** goed — daarom geen auto-apply. Beoordeel handmatig en merge als je akkoord bent.',
  );
  lines.push('');
  needsReview.forEach((p) => {
    lines.push(`### \`${p.keyword}\` → \`${p.list}Keywords\``);
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
    await setOutput('applied', 'false');
    await setOutput('needs_review', 'false');
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

      // --- Diagnose-logging: precies wat de analyzer op deze host zag. ---
      const d = result.detection;
      const cls = result.classification;
      console.log(`   categorie : ${cls.category}`);
      console.log(`   reden     : ${cls.reason}`);
      console.log(
        `   banner    : ${d ? (d.bannerVisible ? 'zichtbaar' : 'NIET gevonden') : 'geen detectie'}` +
          ` · TCF: ${d?.hasTcf ? 'ja' : 'nee'} · CMP: [${(cls.cmps ?? []).join(', ') || '-'}]`,
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
      `   judge [${p.list}] "${p.keyword}" → ${judgement.verdict}/${judgement.confidence}`,
    );
    judged.push({ ...p, judgement });
  }
  const applied = judged.filter((j) => isAutoApprove(j.judgement));
  const needsReview = judged.filter((j) => !isAutoApprove(j.judgement));

  const { added } = mergeProposals(
    rules,
    applied.map((p) => ({ keyword: p.keyword, list: p.list })),
  );
  if (added.length) await saveRules(rules);

  // #reward-2 + #reward-3: een host geldt als "opgelost" wanneer voor die host
  // een NIEUW keyword auto-toegepast is. Registreer die hosts voor de publieke
  // /fixed-changelog en stuur de opt-in "nu opgelost"-mail naar hun watchers.
  const addedKeys = new Set(added.map((a) => `${a.list}:${a.keyword}`));
  const fixedByHost = new Map<string, { keyword: string; list: string }>();
  for (const p of applied) {
    if (!addedKeys.has(`${p.list}:${p.keyword}`)) continue;
    if (!fixedByHost.has(p.hostname)) {
      fixedByHost.set(p.hostname, { keyword: p.keyword, list: p.list });
    }
  }
  if (fixedByHost.size) {
    const fixedEntries = Array.from(fixedByHost.entries()).map(
      ([hostname, k]) => ({ hostname, keyword: k.keyword, list: k.list }),
    );
    try {
      await recordFixed(redis, fixedEntries);
    } catch (err) {
      console.warn('[analyze] recordFixed faalde:', err);
    }
    // Opt-in notify — best-effort, nooit de run laten klappen.
    let notified = 0;
    for (const { hostname } of fixedEntries) {
      const watchers = await getWatchers(redis, hostname);
      if (!watchers.length) continue;
      let anySent = false;
      for (const email of watchers) {
        if (await sendFixedEmail(email, hostname)) {
          notified++;
          anySent = true;
        }
      }
      // Alleen wissen als er (deels) verstuurd is; anders volgende run opnieuw.
      if (anySent) await clearWatchers(redis, hostname);
    }
    console.log(
      `Fixes geregistreerd: ${fixedEntries.length}. Notify-mails verstuurd: ${notified}.`,
    );
  }

  await writeFile(
    'needs-review.json',
    JSON.stringify(
      needsReview.map((p) => ({
        keyword: p.keyword,
        list: p.list,
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
      .map((p) => `- [${p.list}] ${p.keyword} (${p.hostname}): ${p.judgement.reason}`)
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
