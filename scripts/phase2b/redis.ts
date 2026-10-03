/**
 * Phase 2B analyzer — Redis-laag.
 *
 * Leest de Phase 2A-meldingen (geschreven door deploy/api/report.ts) uit
 * Upstash Redis, houdt bij welke al onderzocht zijn, en bewaart per host het
 * laatste analyse-resultaat.
 *
 * Hergebruikt de Phase 2A key-schema's; voegt twee eigen keys toe:
 *   bb:analyzed         SET    report-id's die al onderzocht zijn (idempotentie)
 *   bb:analysis:{host}  STRING (JSON) laatste analyse per host, TTL 180d
 *   bb:fixed            ZSET   opgeloste hosts (score=fixedAt), publiek via /fixed
 *   bb:fixed:meta:{h}   STRING (JSON) keyword + datum per host, GEEN TTL
 *   bb:fixed:pending    HASH   voorgestelde fixes, wachtend op een merge
 *
 * Env: KV_REST_API_URL + KV_REST_API_TOKEN (zelfde als Vercel). fromEnv()
 * pakt ook UPSTASH_REDIS_REST_URL/TOKEN op.
 */

import { Redis } from '@upstash/redis';

export interface StoredReport {
  id: string;
  hostname: string;
  version: string;
  message: string;
  ts: number;
}

/** Een host met de (nog niet geanalyseerde) report-id's die erbij horen. */
export interface HostWork {
  hostname: string;
  reportIds: string[];
  sampleMessage: string;
  lastTs: number;
}

const ANALYSIS_TTL_SECONDS = 180 * 24 * 60 * 60;

export function getRedis(): Redis {
  return Redis.fromEnv();
}

/**
 * Verzamel hosts met nog niet onderzochte meldingen, nieuwste eerst.
 * Pakt maximaal `scanLimit` recente report-id's, filtert reeds-onderzochte
 * eruit, groepeert op hostname en kapt af op `maxHosts`.
 */
export async function getHostsToAnalyze(
  redis: Redis,
  opts: { maxHosts: number; scanLimit?: number },
): Promise<HostWork[]> {
  const scanLimit = opts.scanLimit ?? 500;
  const ids = (await redis.zrange('bb:reports', 0, scanLimit - 1, {
    rev: true,
  })) as string[];
  if (!ids.length) return [];

  // Welke zijn al onderzocht?
  const analyzedFlags = await Promise.all(
    ids.map((id) => redis.sismember('bb:analyzed', id)),
  );
  const freshIds = ids.filter((_, i) => analyzedFlags[i] === 0);
  if (!freshIds.length) return [];

  // Haal de records op en groepeer per host.
  const keys = freshIds.map((id) => `bb:report:${id}`);
  const records = (await redis.mget<StoredReport[]>(...keys)) ?? [];

  const byHost = new Map<string, HostWork>();
  records.forEach((r) => {
    if (!r || typeof r !== 'object' || !r.hostname) return;
    const existing = byHost.get(r.hostname);
    if (existing) {
      existing.reportIds.push(r.id);
      if (r.ts > existing.lastTs) {
        existing.lastTs = r.ts;
        if (r.message) existing.sampleMessage = r.message;
      }
    } else {
      byHost.set(r.hostname, {
        hostname: r.hostname,
        reportIds: [r.id],
        sampleMessage: r.message || '',
        lastTs: r.ts,
      });
    }
  });

  return Array.from(byHost.values())
    .sort((a, b) => b.lastTs - a.lastTs)
    .slice(0, opts.maxHosts);
}

/** Markeer report-id's als onderzocht (idempotent). */
export async function markAnalyzed(
  redis: Redis,
  ids: string[],
): Promise<void> {
  if (!ids.length) return;
  await redis.sadd('bb:analyzed', ids[0], ...ids.slice(1));
}

/** Bewaar het laatste analyse-resultaat van een host. */
export async function writeAnalysis(
  redis: Redis,
  hostname: string,
  record: unknown,
): Promise<void> {
  await redis.set(`bb:analysis:${hostname}`, record, {
    ex: ANALYSIS_TTL_SECONDS,
  });
}

export interface FixedEntry {
  hostname: string;
  keyword: string;
  list: string;
  fixedAt: number;
}

/**
 * #reward-2: registreer opgeloste hosts voor de publieke /fixed-changelog.
 * bb:fixed ZSET (score=fixedAt, member=host, dedup per host) + per-host meta.
 * Bevat GEEN persoonlijke data — alleen hostname + keyword + datum.
 */
export async function recordFixed(
  redis: Redis,
  entries: { hostname: string; keyword: string; list: string; fixedAt?: number }[],
): Promise<void> {
  if (!entries.length) return;
  const now = Date.now();
  const p = redis.pipeline();
  for (const e of entries) {
    const fixedAt = e.fixedAt ?? now;
    p.zadd('bb:fixed', { score: fixedAt, member: e.hostname });
    // GEEN TTL: de ZSET-vermelding verloopt ook niet. Stond de meta wel op
    // 180 dagen, dan bleef de hostnaam staan terwijl keyword en datum
    // verdwenen — /fixed toonde die regel dan met een lege reden en 1970 als
    // datum. De changelog is publiek en permanent; laat beide samen leven.
    p.set(`bb:fixed:meta:${e.hostname}`, {
      hostname: e.hostname,
      keyword: e.keyword,
      list: e.list,
      fixedAt,
    });
  }
  await p.exec();
}

/**
 * Een voorgestelde fix parkeren tot hij daadwerkelijk is uitgerold.
 *
 * Sinds de security-audit (2026-09-16) wordt geen enkel keyword meer direct
 * toegepast: alles gaat via een PR die Robin zelf merget. "Opgelost" is dus
 * niet het moment waarop de analyse een voorstel doet, maar het moment waarop
 * het keyword live staat. Zou de pijplijn hier al `recordFixed` aanroepen,
 * dan beloofde de publieke changelog fixes die nog afgekeurd konden worden.
 *
 * Daarom: hier parkeren op keyword, en `promotePendingFixes()` haalt het er
 * bij een volgende run uit zodra het keyword echt in rules.json staat.
 */
export async function recordPendingFix(
  redis: Redis,
  entries: { hostname: string; keyword: string; list: string }[],
): Promise<void> {
  if (!entries.length) return;
  const now = Date.now();
  const p = redis.pipeline();
  for (const e of entries) {
    p.hset('bb:fixed:pending', {
      [e.keyword.toLowerCase()]: {
        hostname: e.hostname,
        keyword: e.keyword,
        list: e.list,
        proposedAt: now,
      },
    });
  }
  await p.exec();
}

interface PendingFix {
  hostname: string;
  keyword: string;
  list: string;
  proposedAt: number;
}

/**
 * Verhuis geparkeerde voorstellen naar de publieke changelog zodra hun keyword
 * in de live regelset staat. Draait aan het begin van elke analyse-run, dus een
 * PR die vandaag gemerged wordt verschijnt bij de eerstvolgende melding op
 * /fixed. Een voorstel dat Robin afkeurt blijft staan en wordt nooit getoond;
 * `maxAgeDays` ruimt die na verloop van tijd op.
 */
export async function promotePendingFixes(
  redis: Redis,
  liveKeywords: string[],
  opts: { maxAgeDays?: number } = {},
): Promise<{ promoted: string[]; dropped: string[] }> {
  const live = new Set(liveKeywords.map((k) => k.toLowerCase()));
  const promoted: string[] = [];
  const dropped: string[] = [];
  try {
    const pending =
      ((await redis.hgetall('bb:fixed:pending')) as Record<
        string,
        PendingFix
      > | null) ?? {};
    const keys = Object.keys(pending);
    if (!keys.length) return { promoted, dropped };

    const maxAgeMs = (opts.maxAgeDays ?? 120) * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const toRecord: { hostname: string; keyword: string; list: string }[] = [];
    const toDelete: string[] = [];

    for (const key of keys) {
      const entry = pending[key];
      if (!entry?.hostname) {
        toDelete.push(key);
        continue;
      }
      if (live.has(key)) {
        toRecord.push({
          hostname: entry.hostname,
          keyword: entry.keyword,
          list: entry.list,
        });
        toDelete.push(key);
        promoted.push(entry.hostname);
      } else if (now - (entry.proposedAt ?? now) > maxAgeMs) {
        toDelete.push(key);
        dropped.push(entry.hostname);
      }
    }

    if (toRecord.length) await recordFixed(redis, toRecord);
    if (toDelete.length) await redis.hdel('bb:fixed:pending', ...toDelete);
  } catch (err) {
    // De changelog mag een analyse-run nooit laten vallen.
    console.error('[redis] promotePendingFixes failed:', err);
  }
  return { promoted, dropped };
}

/**
 * #reward-3: haal de opt-in e-mail-watchers van een host op (kan leeg zijn).
 * Geschreven door deploy/api/report.ts als `bb:host:watchers:{host}` SET.
 */
export async function getWatchers(
  redis: Redis,
  hostname: string,
): Promise<string[]> {
  try {
    const emails = (await redis.smembers(
      `bb:host:watchers:${hostname}`,
    )) as string[];
    return Array.isArray(emails) ? emails.filter(Boolean) : [];
  } catch {
    return [];
  }
}

/** #reward-3: verwijder de watcher-SET nadat de seintjes verstuurd zijn. */
export async function clearWatchers(
  redis: Redis,
  hostname: string,
): Promise<void> {
  try {
    await redis.del(`bb:host:watchers:${hostname}`);
  } catch {
    // Niet kritiek — verloopt anders vanzelf via TTL.
  }
}
