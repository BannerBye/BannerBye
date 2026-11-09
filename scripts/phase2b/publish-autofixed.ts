/**
 * Pijplijn v2 (0.4.17) — ná een geslaagde push van host-regels: de publieke
 * /fixed-changelog bijwerken, het ticket van de melder op "fixed" zetten en
 * opt-in-melders mailen. Draait pas als de push slaagde, zodat /fixed nooit
 * iets belooft wat niet live staat.
 */

import { readFile } from 'node:fs/promises';
import { getRedis, recordFixed, getWatchers, clearWatchers } from './redis.ts';
import { sendFixedEmail } from './notify.ts';

interface Entry {
  hostname: string;
  keyword: string;
  list: string;
}

async function main(): Promise<void> {
  let raw: string;
  try {
    raw = await readFile('hostrules-to-apply.json', 'utf8');
  } catch {
    console.log('Geen hostrules-to-apply.json — niets te publiceren.');
    return;
  }
  const entries = (JSON.parse(raw) as Entry[]).filter((e) => e.hostname && e.keyword);
  if (!entries.length) return;
  const redis = getRedis();
  // Eén regel per host op /fixed (eerste keyword als samenvatting).
  const byHost = new Map<string, Entry>();
  for (const e of entries) if (!byHost.has(e.hostname)) byHost.set(e.hostname, e);
  await recordFixed(
    redis,
    Array.from(byHost.values()).map((e) => ({ hostname: e.hostname, keyword: e.keyword, list: `${e.list} (host-scoped)` })),
  );
  console.log(`/fixed bijgewerkt voor: ${Array.from(byHost.keys()).join(', ')}`);
  for (const host of byHost.keys()) {
    const watchers = await getWatchers(redis, host);
    for (const to of watchers) await sendFixedEmail(to, host);
    if (watchers.length) await clearWatchers(redis, host);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
