/**
 * Anonieme terugkoppeling op meldingen (v0.4.12, 21 okt 2026).
 *
 * Het probleem: wie "Report broken site" drukt, hoort nooit iets terug — tenzij
 * hij een e-mailadres achterliet, precies het persoonsgegeven dat we niet willen.
 * Gevolg: dezelfde site wordt opnieuw gemeld en de melder denkt dat er niets
 * gebeurt (reactormag.com, 21 okt 2026).
 *
 * De oplossing: een ticket dat alleen dit apparaat kent.
 *   1. Bij een melding maakt de extensie hier een willekeurig ID (`xxxx-xxxx`,
 *      base36 uit crypto.getRandomValues) en stuurt dat mee naar /api/report.
 *      De server bewaart per ticket alleen de hostname (180 d).
 *   2. Het ID staat in chrome.storage.local naast de hostname — zoals de
 *      bewijslijst. Geen account, geen e-mail, geen device-ID; de server kan
 *      niet zien of twee tickets van dezelfde persoon zijn.
 *   3. Bij het openen van de popup, hooguit 1× per uur, vraagt de extensie
 *      GET /api/report-status?ids=… voor de EIGEN tickets en toont één regel
 *      onder de site: received / investigating / fixed (in versie X) /
 *      not-a-bug met korte uitleg. Geen notificatie, geen badge (§17:
 *      engage without pressure).
 *   4. Tickets die 'fixed' zijn in een versie die hier al draait, en tickets
 *      ouder dan 90 dagen, worden lokaal opgeruimd. "Clear list" in de popup
 *      wist ook de tickets.
 *
 * Alles via bannerbye.com, dat de extensie al mag bereiken — geen nieuwe
 * permissie, geen nieuwe host.
 */

import { getStats } from './storage.ts';
import type { LocalStats, TicketEntry, TicketStatus } from './types.ts';

export const TICKET_STATUS_ENDPOINT = 'https://bannerbye.com/api/report-status';
/** Minimale tussenpoos tussen twee statuschecks. */
export const TICKET_CHECK_INTERVAL_MS = 60 * 60 * 1000;
/** Oude tickets opruimen (de server bewaart ze 180 d; wij korter). */
const TICKET_TTL_MS = 90 * 24 * 60 * 60 * 1000;
/** Nooit meer dan dit aantal tickets bewaren — één per melding, 20 is ruim. */
const TICKET_CAP = 20;
/** Zelfde formaat als de server eist (lib/store.ts TICKET_ID_RE). */
const TICKET_ID_RE = /^[a-z0-9]{4}-[a-z0-9]{4}$/;

const STATS_KEY = 'stats'; // zelfde sleutel als storage.ts
const STATUSES: TicketStatus[] = ['received', 'investigating', 'fixed', 'not-a-bug'];

/** Willekeurig ticket-ID: 8 tekens base36, met een streepje voor de leesbaarheid. */
export function newTicketId(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < 8; i++) {
    out += alphabet[bytes[i]! % alphabet.length];
    if (i === 3) out += '-';
  }
  return out;
}

async function writeStats(next: LocalStats): Promise<void> {
  await chrome.storage.local.set({ [STATS_KEY]: next });
}

/** Bewaar een nieuw ticket voor `host`. Eén ticket per host: een nieuwe melding vervangt de oude. */
export async function addTicket(host: string, id: string): Promise<LocalStats> {
  const h = host.trim().toLowerCase();
  if (!h || !TICKET_ID_RE.test(id)) return getStats();
  const current = await getStats();
  const entry: TicketEntry = { id, host: h, createdAt: Date.now(), status: 'received' };
  const tickets = [entry, ...current.tickets.filter((t) => t.host !== h)].slice(0, TICKET_CAP);
  // Meteen weer ophalen bij de volgende popup-opening: een verse melding wil
  // je snel bevestigd zien, de uurgrens geldt pas daarna.
  const next: LocalStats = { ...current, tickets, ticketsCheckedAt: 0 };
  await writeStats(next);
  return next;
}

/** Alle tickets wissen (hoort bij "Clear list" in de popup). */
export async function clearTickets(): Promise<LocalStats> {
  const current = await getStats();
  const next: LocalStats = { ...current, tickets: [], ticketsCheckedAt: 0 };
  await writeStats(next);
  return next;
}

/** Simpele semver-vergelijking: a >= b. */
export function versionAtLeast(a: string, b: string): boolean {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

interface StatusResponse {
  tickets?: Record<
    string,
    { hostname?: string; status?: string; note?: string; version?: string; ts?: number }
  >;
}

/**
 * Haal de status van de eigen tickets op — hooguit 1× per uur, tenzij
 * `force`. Ruimt afgehandelde en verlopen tickets op. Faalt altijd stil: een
 * netwerkfout laat de popup nooit klappen en wordt bij de volgende opening
 * gewoon opnieuw geprobeerd.
 */
export async function refreshTicketStatuses(opts: { force?: boolean } = {}): Promise<LocalStats> {
  const current = await getStats();
  const now = Date.now();

  // Opruimen: te oud, of gefixt in een versie die hier al draait (die regel
  // blijft nog twee weken staan zodat de melder "fixed — you have it" ziet).
  const installed = chrome.runtime.getManifest().version;
  const TWO_WEEKS = 14 * 24 * 60 * 60 * 1000;
  const kept = current.tickets.filter((t) => {
    const age = now - t.createdAt;
    if (age > TICKET_TTL_MS) return false;
    if (t.status === 'fixed' && t.version && versionAtLeast(installed, t.version)) {
      return age < TWO_WEEKS;
    }
    return true;
  });

  if (!kept.length) {
    if (kept.length !== current.tickets.length) {
      const next = { ...current, tickets: kept };
      await writeStats(next);
      return next;
    }
    return current;
  }

  if (!opts.force && now - current.ticketsCheckedAt < TICKET_CHECK_INTERVAL_MS) {
    if (kept.length !== current.tickets.length) {
      const next = { ...current, tickets: kept };
      await writeStats(next);
      return next;
    }
    return current;
  }

  let updated = kept;
  try {
    const ids = kept.map((t) => t.id).join(',');
    const res = await fetch(`${TICKET_STATUS_ENDPOINT}?ids=${encodeURIComponent(ids)}`, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
    });
    if (res.ok) {
      const data = (await res.json()) as StatusResponse;
      const map = data.tickets ?? {};
      updated = kept.map((t) => {
        const r = map[t.id];
        if (!r || !r.status || !STATUSES.includes(r.status as TicketStatus)) return t;
        return {
          ...t,
          status: r.status as TicketStatus,
          note: typeof r.note === 'string' && r.note ? r.note.slice(0, 200) : undefined,
          version: typeof r.version === 'string' && r.version ? r.version.slice(0, 16) : undefined,
        };
      });
    }
  } catch {
    // Offline of server niet bereikbaar — volgende keer opnieuw.
  }

  const next: LocalStats = { ...current, tickets: updated, ticketsCheckedAt: now };
  await writeStats(next);
  return next;
}
