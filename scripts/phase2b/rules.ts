/**
 * Phase 2B — canonieke rules.json lezen/mergen/schrijven.
 *
 * Bron-van-waarheid: repo/rules.json (twee niveaus boven dit bestand).
 * Na merge + PR-merge publiceer je naar productie via PUBLISH.md.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

export interface KeywordFields {
  rejectKeywords?: string[];
  ambiguousKeywords?: string[];
  stepIntoKeywords?: string[];
  rejectPhrases?: string[];
  contextWords?: string[];
  attributeWordHints?: string[];
  attributeCompactHints?: string[];
}

export interface RemoteRules {
  version: number;
  updatedAt?: string;
  autoclick?: KeywordFields & {
    /**
     * v0.4.5 (fix #3): host-scoped aanvullingen, sleutel = hostname. De
     * extensie past ze alleen toe op die host en zijn subdomeinen. v0.4.17
     * (pijplijn v2) schrijft hier de automatisch toegepaste fixes naartoe —
     * blast radius één host, zie analyze.ts.
     */
    hostRules?: Record<string, KeywordFields>;
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
    for (const f of changedFields) (a[f as keyof KeywordFields] as string[]).sort();
    rules.updatedAt = new Date().toISOString();
  }
  return { added };
}

/**
 * v0.4.17 (pijplijn v2): voorstellen host-scoped toevoegen onder
 * `autoclick.hostRules[host]`. Dedupliceert tegen de globale lijst én de
 * bestaande host-regel. Geeft terug welke écht nieuw waren.
 */
export function mergeHostProposals(
  rules: RemoteRules,
  hostname: string,
  proposals: KeywordProposal[],
): { added: KeywordProposal[] } {
  const a = (rules.autoclick = rules.autoclick ?? {});
  const host = hostname.toLowerCase().trim();
  const hostRules = (a.hostRules = a.hostRules ?? {});
  const entry = (hostRules[host] = hostRules[host] ?? {});
  const added: KeywordProposal[] = [];
  for (const p of proposals) {
    const field = LIST_FIELD[p.list];
    const low = p.keyword.toLowerCase().trim();
    if (!low) continue;
    const globalArr = a[field] ?? [];
    if (globalArr.some((k) => k.toLowerCase() === low)) continue;
    const arr = (entry[field] = entry[field] ?? []);
    if (arr.some((k) => k.toLowerCase() === low)) continue;
    arr.push(low);
    arr.sort();
    added.push({ keyword: low, list: p.list });
  }
  if (added.length) rules.updatedAt = new Date().toISOString();
  return { added };
}

/** Alle keywords die op `hostname` van toepassing zijn (globaal + host-regels). */
export function keywordsForHost(rules: RemoteRules, hostname: string): KeywordFields & { hostRules?: Record<string, KeywordFields> } {
  const a = rules.autoclick ?? {};
  return {
    rejectKeywords: a.rejectKeywords ?? [],
    ambiguousKeywords: a.ambiguousKeywords ?? [],
    stepIntoKeywords: a.stepIntoKeywords ?? [],
    rejectPhrases: a.rejectPhrases ?? [],
    contextWords: a.contextWords ?? [],
    attributeWordHints: a.attributeWordHints ?? [],
    attributeCompactHints: a.attributeCompactHints ?? [],
    hostRules: a.hostRules ?? {},
  };
}

/**
 * Keywords die op ≥ `minHosts` verschillende hosts in hostRules staan zijn
 * kandidaat om globaal te worden — die komen in de review-PR voor Robin.
 */
export function hostRuleKeywordsSeenOn(
  rules: RemoteRules,
  minHosts: number,
): Array<KeywordProposal & { hosts: string[] }> {
  const a = rules.autoclick ?? {};
  const seen = new Map<string, { list: KeywordList; hosts: Set<string> }>();
  for (const [host, fields] of Object.entries(a.hostRules ?? {})) {
    for (const [list, field] of Object.entries(LIST_FIELD) as Array<[KeywordList, keyof KeywordFields]>) {
      for (const kw of fields[field] ?? []) {
        const key = `${list}:${kw.toLowerCase()}`;
        const e = seen.get(key) ?? { list, hosts: new Set<string>() };
        e.hosts.add(host);
        seen.set(key, e);
      }
    }
  }
  const out: Array<KeywordProposal & { hosts: string[] }> = [];
  for (const [key, e] of seen) {
    if (e.hosts.size < minHosts) continue;
    const keyword = key.slice(key.indexOf(':') + 1);
    const globalArr = a[LIST_FIELD[e.list]] ?? [];
    if (globalArr.some((k) => k.toLowerCase() === keyword)) continue;
    out.push({ keyword, list: e.list, hosts: Array.from(e.hosts).sort() });
  }
  return out;
}

export async function saveRules(rules: RemoteRules): Promise<void> {
  await writeFile(RULES_PATH, JSON.stringify(rules, null, 2) + '\n', 'utf8');
}
