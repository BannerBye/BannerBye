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

export async function loadRules(): Promise<RemoteRules> {
  const raw = await readFile(RULES_PATH, 'utf8');
  const parsed = JSON.parse(raw) as RemoteRules;
  parsed.autoclick = parsed.autoclick ?? {};
  parsed.autoclick.rejectKeywords = parsed.autoclick.rejectKeywords ?? [];
  return parsed;
}

/**
 * Voeg nieuwe (al genormaliseerde) reject-keywords toe. Dedupliceert
 * case-insensitive tegen wat er al staat. Geeft terug welke écht nieuw waren.
 */
export function mergeRejectKeywords(
  rules: RemoteRules,
  keywords: string[],
): { added: string[] } {
  const current = new Set(
    (rules.autoclick!.rejectKeywords ?? []).map((k) => k.toLowerCase()),
  );
  const added: string[] = [];
  for (const kw of keywords) {
    const low = kw.toLowerCase();
    if (!low || current.has(low)) continue;
    current.add(low);
    rules.autoclick!.rejectKeywords!.push(kw);
    added.push(kw);
  }
  if (added.length) {
    rules.autoclick!.rejectKeywords!.sort();
    rules.updatedAt = new Date().toISOString();
  }
  return { added };
}

export async function saveRules(rules: RemoteRules): Promise<void> {
  await writeFile(RULES_PATH, JSON.stringify(rules, null, 2) + '\n', 'utf8');
}
