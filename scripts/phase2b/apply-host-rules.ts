/**
 * Pijplijn v2 (0.4.17) — host-scoped fixes in rules.json zetten, vóór de
 * directe push naar main.
 *
 * Leest `hostrules-to-apply.json` (door analyze.ts geschreven: alleen
 * voorstellen die Claude met approve/high beoordeelde) en voegt elk keyword
 * toe onder `autoclick.hostRules[host]`. De extensie past zo'n regel alleen
 * toe op die host en zijn subdomeinen (keywords.ts, isHostRuleMatch) — de
 * blast radius van een vergissing is dus één site, niet het hele web.
 *
 * Dit is de bewuste, afgebakende uitzondering op security-fix #1
 * (2026-09-16, "niets automatisch live"). Globale keywords gaan nog steeds
 * uitsluitend via de review-PR (apply-needs-review.ts).
 */

import { readFile } from 'node:fs/promises';
import { loadRules, mergeHostProposals, saveRules, type KeywordList } from './rules.ts';

interface Entry {
  hostname: string;
  keyword: string;
  list?: KeywordList;
}

async function main(): Promise<void> {
  let raw: string;
  try {
    raw = await readFile('hostrules-to-apply.json', 'utf8');
  } catch {
    console.log('Geen hostrules-to-apply.json — niets te doen.');
    return;
  }
  const entries = (JSON.parse(raw) as Entry[]).filter((e) => e.hostname && e.keyword);
  if (!entries.length) {
    console.log('Geen host-regels toe te passen.');
    return;
  }
  const rules = await loadRules();
  let total = 0;
  for (const e of entries) {
    if (!/^[a-z0-9.-]+$/.test(e.hostname)) continue;
    const { added } = mergeHostProposals(rules, e.hostname, [{ keyword: e.keyword, list: e.list ?? 'reject' }]);
    total += added.length;
    for (const a of added) console.log(`host-regel: ${e.hostname} ← [${a.list}] ${a.keyword}`);
  }
  if (total) {
    await saveRules(rules);
    console.log(`${total} host-regel(s) weggeschreven.`);
  } else {
    console.log('Alle host-regels stonden er al.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
