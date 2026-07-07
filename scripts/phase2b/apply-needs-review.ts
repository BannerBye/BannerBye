/**
 * Phase 2C — needs-review keywords in rules.json zetten vóór de draft-PR.
 *
 * Draait NA de auto-apply-commit, op een schone landing-checkout. Leest
 * needs-review.json (door analyze.ts geschreven), voegt die keywords toe aan
 * RULES_FILE, zodat create-pull-request een branch met precies die diff maakt.
 */

import { readFile } from 'node:fs/promises';
import {
  loadRules,
  mergeProposals,
  saveRules,
  type KeywordList,
} from './rules.ts';

interface NeedsReviewEntry {
  keyword: string;
  list?: KeywordList;
}

async function main(): Promise<void> {
  let raw: string;
  try {
    raw = await readFile('needs-review.json', 'utf8');
  } catch {
    console.log('Geen needs-review.json — niets te doen.');
    return;
  }
  const entries = JSON.parse(raw) as NeedsReviewEntry[];
  const proposals = entries
    .filter((e) => e.keyword)
    .map((e) => ({ keyword: e.keyword, list: e.list ?? 'reject' }));
  if (!proposals.length) {
    console.log('Geen needs-review keywords.');
    return;
  }
  const rules = await loadRules();
  const { added } = mergeProposals(rules, proposals);
  if (added.length) {
    await saveRules(rules);
    console.log(
      `Needs-review toegevoegd voor PR: ${added.map((a) => `${a.keyword}[${a.list}]`).join(', ')}`,
    );
  } else {
    console.log('Needs-review keywords stonden al in rules.json.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
