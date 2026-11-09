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

/** Spiegel van `ReportSnapshot` in de extensie (src/lib/report-snapshot.ts). */
export interface ReportSnapshot {
  v: number;
  at: number;
  candidates: Array<{ text: string; tag: string; inBanner: boolean; attrs?: string[] }>;
  bannerFound: boolean;
  bannerText: string;
  cmps: string[];
  iframes: string[];
  pageLang: string;
  uiLang: string;
  viewport: { w: number; h: number };
  totalClickables: number;
}

export interface StoredReport {
  id: string;
  hostname: string;
  version: string;
  message: string;
  ts: number;
  /** User-agent van de melder (door api/report.ts uit de header gehaald). */
  ua?: string;
  /** v0.4.17 (pijplijn v2) — context van de melder, zie api/report.ts. */
  path?: string;
  lang?: string;
  snapshot?: ReportSnapshot;
  trace?: string;
}

/** Een host met de (nog niet geanalyseerde) report-id's die erbij horen. */
export interface HostWork {
  hostname: string;
  reportIds: string[];
  sampleMessage: string;
  lastTs: number;
  /** v0.4.17: context van de meest recente melding die 'm meestuurde. */
  path?: string;
  lang?: string;
  ua?: string;
  snapshot?: ReportSnapshot;
  trace?: string;
  version?: string;
  /** Alleen in retry-modus: het hoeveelste bezoek dit is (1 = eerste run). */
  attempt?: number;
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
  const applyContext = (w: HostWork, r: StoredReport): void => {
    // Nieuwste melding wint, maar een oudere mét snapshot/pad is meer waard
    // dan een nieuwere zonder — vul alleen aan wat nog leeg is.
    if (r.path && (!w.path || w.path === '/')) w.path = r.path;
    if (r.lang && !w.lang) w.lang = r.lang;
    if (r.ua && !w.ua) w.ua = r.ua;
    if (r.snapshot && !w.snapshot) w.snapshot = r.snapshot;
    if (r.trace && !w.trace) w.trace = r.trace;
    if (r.version && !w.version) w.version = r.version;
  };
  records.forEach((r) => {
    if (!r || typeof r !== 'object' || !r.hostname) return;
    const existing = byHost.get(r.hostname);
    if (existing) {
      existing.reportIds.push(r.id);
      if (r.ts > existing.lastTs) {
        existing.lastTs = r.ts;
        if (r.message) existing.sampleMessage = r.message;
        // Nieuwere context overschrijft wél als ze er is.
        if (r.path) existing.path = r.path;
        if (r.lang) existing.lang = r.lang;
        if (r.ua) existing.ua = r.ua;
        if (r.snapshot) existing.snapshot = r.snapshot;
        if (r.trace) existing.trace = r.trace;
        if (r.version) existing.version = r.version;
      } else {
        applyContext(existing, r);
      }
    } else {
      const w: HostWork = {
        hostname: r.hostname,
        reportIds: [r.id],
        sampleMessage: r.message || '',
        lastTs: r.ts,
      };
      applyContext(w, r);
      byHost.set(r.hostname, w);
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
  entries: { hostname: string; keyword: string; list: string; fixedAt?: number; version?: string }[],
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
      // v0.4.12: extensieversie van een codefix, zodat de popup "fixed in
      // 0.4.x — update to get it" kan tonen (ticket-terugkoppeling). Leeg bij
      // een keyword-fix: die komt via de regellijst zonder update.
      ...(e.version ? { version: e.version } : {}),
    });
    // Een expliciete host-status (bv. 'investigating') is hiermee achterhaald.
    p.del(`bb:host:status:${e.hostname}`);
  }
  await p.exec();
}

/**
 * v0.4.12: expliciete fix-status per host voor de anonieme ticket-
 * terugkoppeling (zie deploy/lib/store.ts). De pijplijn zet 'investigating'
 * zodra een voorstel in de review-PR staat en 'not-a-bug' bij accept-only;
 * 'fixed' volgt vanzelf uit bb:fixed. Geen persoonsgegevens: alleen hostname
 * + status + korte publieke uitleg. TTL 180 d, zoals de meldingen zelf.
 */
export async function setHostStatus(
  redis: Redis,
  hostname: string,
  status: 'received' | 'investigating' | 'fixed' | 'not-a-bug',
  note?: string,
  version?: string,
): Promise<void> {
  await redis.set(
    `bb:host:status:${hostname}`,
    {
      status,
      ...(note ? { note: note.slice(0, 200) } : {}),
      ...(version ? { version } : {}),
      ts: Date.now(),
    },
    { ex: ANALYSIS_TTL_SECONDS },
  );
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

// ---------------------------------------------------------------------------
// v0.4.17 (pijplijn v2) — herhaalpogingen.
//
//   bb:retry            ZSET   score = wanneer opnieuw proberen (ms), member = host
//   bb:retry:meta:{h}   STRING (JSON) HostWork + pogingen + wat er geprobeerd is
//
// Een host die in geen enkel profiel een banner liet zien is NIET "vals
// positief". Hij gaat in de wachtrij en wordt tot MAX_ATTEMPTS keer opnieuw
// bezocht met andere profielen (zie analyze.ts). Pas daarna is het een zaak
// voor een mens, en dat zegt de mail dan ook letterlijk.
// ---------------------------------------------------------------------------

export const RETRY_MAX_ATTEMPTS = 3;
export const RETRY_DELAY_MS = 6 * 60 * 60 * 1000;

export interface RetryMeta {
  work: HostWork;
  attempts: number;
  tried: string[];
  firstSeen: number;
  nextAt: number;
}

export async function scheduleRetry(
  redis: Redis,
  work: HostWork,
  tried: string[],
  opts: { delayMs?: number } = {},
): Promise<RetryMeta> {
  const key = `bb:retry:meta:${work.hostname}`;
  const prev = (await redis.get(key)) as RetryMeta | null;
  const attempts = (prev?.attempts ?? 0) + 1;
  const nextAt = Date.now() + (opts.delayMs ?? RETRY_DELAY_MS);
  const meta: RetryMeta = {
    work: { ...work, attempt: attempts + 1 },
    attempts,
    tried: Array.from(new Set([...(prev?.tried ?? []), ...tried])),
    firstSeen: prev?.firstSeen ?? Date.now(),
    nextAt,
  };
  const p = redis.pipeline();
  p.set(key, meta, { ex: 14 * 24 * 60 * 60 });
  p.zadd('bb:retry', { score: nextAt, member: work.hostname });
  await p.exec();
  return meta;
}

export async function getRetryMeta(redis: Redis, hostname: string): Promise<RetryMeta | null> {
  try {
    return ((await redis.get(`bb:retry:meta:${hostname}`)) as RetryMeta | null) ?? null;
  } catch {
    return null;
  }
}

/** Hosts waarvan de wachttijd om is, oudste eerst. */
export async function getDueRetries(redis: Redis, max: number): Promise<RetryMeta[]> {
  const hosts = (await redis.zrange('bb:retry', 0, Date.now(), {
    byScore: true,
    offset: 0,
    count: max,
  })) as string[];
  if (!hosts.length) return [];
  const metas = await Promise.all(hosts.map((h) => getRetryMeta(redis, h)));
  return metas.filter((m): m is RetryMeta => !!m && !!m.work?.hostname);
}

export async function clearRetry(redis: Redis, hostname: string): Promise<void> {
  const p = redis.pipeline();
  p.zrem('bb:retry', hostname);
  p.del(`bb:retry:meta:${hostname}`);
  await p.exec();
}
