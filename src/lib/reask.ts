/**
 * v0.4.19 — vraag-opnieuw-teller, pure logica (los testbaar zonder chrome.*).
 * Zie storage.ts recordReask() en types.ts ReaskEntry.
 */
import { type ReaskEntry, REASK_CAP, REASK_TTL_MS, REASK_MIN_GAP_MS } from './types.ts';

/**
 * v0.4.19 — vraag-opnieuw-teller. Aanroepen bij elke weigering die BannerBye
 * daadwerkelijk aan een zichtbare banner deed (niet bij de preventieve
 * TCF-weigering, die geen vraag van de site is). Pure functie;
 * `recordReask` in storage.ts schrijft het resultaat weg.
 */
export function nextReasks(list: ReaskEntry[], host: string, now: number): ReaskEntry[] {
  const fresh = list.filter((e) => now - e.lastAt < REASK_TTL_MS);
  const existing = fresh.find((e) => e.host === host);
  let entry: ReaskEntry;
  if (!existing) {
    entry = { host, firstAt: now, lastAt: now, reasks: 0 };
  } else if (now - existing.lastAt < REASK_MIN_GAP_MS) {
    entry = { ...existing, lastAt: now };
  } else {
    entry = { ...existing, lastAt: now, reasks: existing.reasks + 1 };
  }
  return [entry, ...fresh.filter((e) => e.host !== host)].slice(0, REASK_CAP);
}

