/**
 * Phase 2B — canonieke rules.json lezen/mergen/schrijven.
 *
 * Bron-van-waarheid: repo/rules.json (twee niveaus boven dit bestand).
 * Na merge + PR-merge publiceer je naar productie via PUBLISH.md.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

export interface RemoteRules {
  version: number;
  updatedAt?: string;
  autoclick?: {
    rejectKeywords?: string[];
    ambiguousKeywords?: string[];
    stepIntoKeywords?: string[];
  };
}

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Doelbestand: in CI wijst RULES_FILE naar de uitgecheckte landing-repo
 * (bv. $GITHUB_WORKSPACE/landing/rules.json). Lokaal valt 't terug op de
 * canonieke repo/rules.json.
 */
export const RULES_PATH = process.env.RULES_FILE
  ? resolve(process.env.RULES_FILE)
  : resolve(here, '../../rules.json');

export type KeywordList = 'reject' | 'ambiguous' | 'stepInto';

export interface KeywordProposal {
  keyword: string;
  list: KeywordList;
}

const LIST_FIELD: Record<KeywordList, 'rejectKeywords' | 'ambiguousKeywords' | 'stepIntoKeywords'> = {
  reject: 'rejectKeywords',
  ambiguous: 'ambiguousKeywords',
  stepInto: 'stepIntoKeywords',
};

export async function loadRules(): Promise<RemoteRules> {
  const raw = await readFile(RULES_PATH, 'utf8');
  const parsed = JSON.parse(raw) as RemoteRules;
  const a = (parsed.autoclick = parsed.autoclick ?? {});
  a.rejectKeywords = a.rejectKeywords ?? [];
  a.ambiguousKeywords = a.ambiguousKeywords ?? [];
  a.stepIntoKeywords = a.stepIntoKeywords ?? [];
  return parsed;
}

/**
 * Voeg voorstellen toe aan de juiste lijst (reject / ambiguous / stepInto).
 * Dedupliceert case-insensitive per lijst. Geeft terug welke écht nieuw waren.
 */
export function mergeProposals(
  rules: RemoteRules,
  proposals: KeywordProposal[],
): { added: KeywordProposal[] } {
  const a = rules.autoclick!;
  const added: KeywordProposal[] = [];
  const changedFields = new Set<string>();

  for (const p of proposals) {
    const field = LIST_FIELD[p.list];
    const arr = (a[field] = a[field] ?? []);
    const low = p.keyword.toLowerCase();
    if (!low || arr.some((k) => k.toLowerCase() === low)) continue;
    arr.push(p.keyword);
    changedFields.add(field);
    added.push(p);
  }
  if (added.length) {
    for (const f of changedFields) a[f as keyof typeof a]!.sort();
    rules.updatedAt = new Date().toISOString();
  }
  return { added };
}

export async function saveRules(rules: RemoteRules): Promise<void> {
  await writeFile(RULES_PATH, JSON.stringify(rules, null, 2) + '\n', 'utf8');
}
