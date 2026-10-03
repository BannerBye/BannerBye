/**
 * Codefixes publiceren op de /fixed-changelog.
 *
 * WAAROM DIT BESTAAT
 * Alleen keyword-fixes lopen door de Phase 2B/2C-pijplijn. Een site die met een
 * codewijziging is gerepareerd (een CMP-handler, een iframe-guard, een
 * PDF-uitzondering) raakt die pijplijn nooit en belandde daarom nooit in de
 * publieke changelog. Dat werd elke release-golf met de hand rechtgezet — en
 * drie keer op rij vergeten.
 *
 * WAT HET DOET
 * Leest `fixed-sites.json` uit de repo-root en schrijft de regels die nog niet
 * in Redis staan naar `bb:fixed` + `bb:fixed:meta:{host}`, via recordFixed().
 *
 * DRIE VANGRAILS
 * 1. Puur additief. Een hostnaam die al in bb:fixed staat wordt overgeslagen,
 *    nooit overschreven. Keyword-fixes uit de pijplijn blijven dus met rust,
 *    ook als iemand dezelfde host per ongeluk in het manifest zet.
 * 2. Geen toekomst. Een regel met een datum die nog niet bereikt is blijft
 *    liggen; de wekelijkse cron pakt hem op zodra de dag er is. Zo kun je het
 *    manifest invullen bij de versiebump zonder iets te beloven wat nog in
 *    review ligt.
 * 3. Harde validatie. Een scheve hostnaam of een onleesbare datum laat de run
 *    falen in plaats van rommel de publieke changelog in te schrijven.
 *
 * GEBRUIK
 *   node --experimental-strip-types publish-fixed.ts [--dry-run]
 * Env: KV_REST_API_URL + KV_REST_API_TOKEN (of UPSTASH_REDIS_REST_*).
 * Optioneel: FIXED_SITES_FILE om een ander manifest te wijzen (tests).
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRedis, recordFixed } from './redis.ts';

interface ManifestEntry {
  hostname: string;
  reason: string;
  label: string;
  version?: string;
  fixedAt: string;
}

const HOSTNAME_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;

const here = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST =
  process.env['FIXED_SITES_FILE'] ||
  path.resolve(here, '..', '..', 'fixed-sites.json');

const DRY_RUN = process.argv.includes('--dry-run');

/** YYYY-MM-DD → 12:00 UTC. Middag, zodat geen tijdzone de dag verschuift. */
function parseDay(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`fixedAt moet YYYY-MM-DD zijn, kreeg "${value}"`);
  }
  const ms = Date.parse(`${value}T12:00:00Z`);
  if (Number.isNaN(ms)) throw new Error(`fixedAt "${value}" is geen geldige datum`);
  return ms;
}

function validate(raw: unknown, index: number): ManifestEntry {
  const where = `fixes[${index}]`;
  if (!raw || typeof raw !== 'object') throw new Error(`${where} is geen object`);
  const e = raw as Record<string, unknown>;

  const hostname = String(e['hostname'] ?? '').trim().toLowerCase();
  if (!HOSTNAME_RE.test(hostname)) {
    throw new Error(
      `${where}: "${hostname}" is geen kale hostnaam (geen protocol, geen pad, geen www-dwang maar wél een punt)`,
    );
  }
  const reason = String(e['reason'] ?? '').trim();
  if (reason.length < 3 || reason.length > 200) {
    throw new Error(`${where}: reason moet 3-200 tekens zijn`);
  }
  const label = String(e['label'] ?? '').trim();
  if (!/^[a-zA-Z][a-zA-Z0-9]{1,39}$/.test(label)) {
    throw new Error(`${where}: label moet korte camelCase zijn, kreeg "${label}"`);
  }
  const fixedAtRaw = String(e['fixedAt'] ?? '');
  parseDay(fixedAtRaw); // gooit bij onzin

  return {
    hostname,
    reason,
    label,
    version: e['version'] ? String(e['version']) : undefined,
    fixedAt: fixedAtRaw,
  };
}

async function main(): Promise<void> {
  const parsed = JSON.parse(await readFile(MANIFEST, 'utf8')) as {
    fixes?: unknown[];
  };
  const list = Array.isArray(parsed.fixes) ? parsed.fixes : [];
  const entries = list.map(validate);

  const seen = new Set<string>();
  for (const e of entries) {
    if (seen.has(e.hostname)) {
      throw new Error(`${e.hostname} staat twee keer in het manifest`);
    }
    seen.add(e.hostname);
  }
  console.log(`${entries.length} regel(s) in ${path.basename(MANIFEST)}, allemaal geldig.`);

  const now = Date.now();
  const due: ManifestEntry[] = [];
  for (const e of entries) {
    if (parseDay(e.fixedAt) > now) {
      console.log(`  wacht   ${e.hostname} — datum ${e.fixedAt} is nog niet bereikt`);
      continue;
    }
    due.push(e);
  }
  if (!due.length) {
    console.log('Niets te publiceren.');
    return;
  }

  const redis = getRedis();

  // Puur additief: alleen hosts die nog niet in de changelog staan.
  const scores = await Promise.all(
    due.map((e) => redis.zscore('bb:fixed', e.hostname)),
  );
  const fresh = due.filter((e, i) => {
    if (scores[i] !== null && scores[i] !== undefined) {
      console.log(`  bestaat ${e.hostname} — ongemoeid gelaten`);
      return false;
    }
    return true;
  });

  if (!fresh.length) {
    console.log('Alles stond er al. Geen schrijfactie.');
    return;
  }

  for (const e of fresh) {
    console.log(`  nieuw   ${e.hostname} — ${e.reason} (${e.fixedAt})`);
  }

  if (DRY_RUN) {
    console.log('\n--dry-run: niets weggeschreven.');
    return;
  }

  await recordFixed(
    redis,
    fresh.map((e) => ({
      hostname: e.hostname,
      keyword: e.reason,
      list: e.label,
      fixedAt: parseDay(e.fixedAt),
    })),
  );

  console.log(`\n${fresh.length} regel(s) toegevoegd aan https://bannerbye.com/fixed`);

  // Voor de workflow-samenvatting.
  const summary = process.env['GITHUB_STEP_SUMMARY'];
  if (summary) {
    const { appendFile } = await import('node:fs/promises');
    await appendFile(
      summary,
      `### /fixed bijgewerkt\n\n${fresh
        .map((e) => `- \`${e.hostname}\` — ${e.reason} (${e.fixedAt})`)
        .join('\n')}\n`,
    );
  }
}

main().catch((err) => {
  console.error('[publish-fixed]', err instanceof Error ? err.message : err);
  process.exit(1);
});
