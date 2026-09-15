/**
 * Phase 2C — alle geoordeelde keyword-voorstellen in rules.json zetten
 * vóór de review-PR.
 *
 * Sinds security-fix bevinding 1 (2026-09-16): er is geen aparte
 * "auto-apply-commit" meer die hieraan voorafgaat — dit is nu de ENIGE plek
 * die rules.json schrijft, en dat gebeurt altijd op een PR-branch, nooit
 * direct op main. Leest proposals-to-stage.json (door analyze.ts
 * geschreven — bevat zowel de hoge-zekerheid- als de lagere-zekerheid-tier,
 * Claude's reject-verdicts zitten er niet in), voegt die keywords toe aan
 * RULES_FILE, zodat create-pull-request een branch met precies die diff
 * maakt. Robin beoordeelt en merget zelf; nooit auto-merge.
 */

import { readFile } from 'node:fs/promises';
import {
  loadRules,
  mergeProposals,
  saveRules,
  type KeywordList,
} from './rules.ts';

interface StageEntry {
  keyword: string;
  list?: KeywordList;
}

async function main(): Promise<void> {
  let raw: string;
  try {
    raw = await readFile('proposals-to-stage.json', 'utf8');
  } catch {
    console.log('Geen proposals-to-stage.json — niets te doen.');
    return;
  }
  const entries = JSON.parse(raw) as StageEntry[];
  const proposals = entries
    .filter((e) => e.keyword)
    .map((e) => ({ keyword: e.keyword, list: e.list ?? 'reject' }));
  if (!proposals.length) {
    console.log('Geen te stagen keywords.');
    return;
  }
  const rules = await loadRules();
  const { added } = mergeProposals(rules, proposals);
  if (added.length) {
    await saveRules(rules);
    console.log(
      `Gestaged voor PR: ${added.map((a) => `${a.keyword}[${a.list}]`).join(', ')}`,
    );
  } else {
    console.log('Voorgestelde keywords stonden al in rules.json.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
