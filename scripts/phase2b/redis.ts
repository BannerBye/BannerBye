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
