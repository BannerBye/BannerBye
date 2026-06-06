/**
 * BannerBye — storage abstractie
 *
 * Eén plek voor alle storage-reads/writes. Wraps chrome.storage.sync
 * (settings, gesynced) en chrome.storage.local (stats, per device).
 *
 * Alle entrypoints (background/content/popup) gebruiken deze module
 * zodat we storage-keys op één plek beheren en types kloppen.
 */

import {
  type SyncedSettings,
  type LocalStats,
  DEFAULT_SETTINGS,
  DEFAULT_STATS,
} from './types';

const SETTINGS_KEY = 'settings';
const STATS_KEY = 'stats';

/**
 * Lees gesynchroniseerde settings. Vult ontbrekende keys aan
 * met defaults zodat we nooit met undefined waarden werken.
 */
export async function getSettings(): Promise<SyncedSettings> {
  const result = await chrome.storage.sync.get(SETTINGS_KEY);
  const stored = (result[SETTINGS_KEY] ?? {}) as Partial<SyncedSettings>;
  return { ...DEFAULT_SETTINGS, ...stored };
}

/**
 * Update settings. Doet een merge met huidige waarden zodat
 * je niet alle velden hoeft mee te sturen.
 */
export async function updateSettings(
  patch: Partial<SyncedSettings>,
): Promise<SyncedSettings> {
  const current = await getSettings();
  const next: SyncedSettings = { ...current, ...patch };
  await chrome.storage.sync.set({ [SETTINGS_KEY]: next });
  return next;
}

/**
 * Helper: pauzeer of unpauzeer een specifiek hostname.
 * Idempotent — dubbel toevoegen is veilig.
 */
export async function setPausedForSite(
  hostname: string,
  paused: boolean,
): Promise<SyncedSettings> {
  const current = await getSettings();
  const set = new Set(current.pausedSites);
  if (paused) {
    set.add(hostname);
  } else {
    set.delete(hostname);
  }
  return updateSettings({ pausedSites: [...set] });
}

/** Lokale stats (niet gesynced) ophalen. */
export async function getStats(): Promise<LocalStats> {
  const result = await chrome.storage.local.get(STATS_KEY);
  const stored = (result[STATS_KEY] ?? {}) as Partial<LocalStats>;
  return { ...DEFAULT_STATS, ...stored };
}

/** Increment de "blocked"-teller. Roep aan bij een succesvol geblokte banner. */
export async function incrementBlocked(by = 1): Promise<LocalStats> {
  const current = await getStats();
  const next: LocalStats = { ...current, blocked: current.blocked + by };
  await chrome.storage.local.set({ [STATS_KEY]: next });
  return next;
}

/** Eenmalig bij install: zet installedAt. */
export async function markInstalled(): Promise<void> {
  const current = await getStats();
  if (current.installedAt === 0) {
    await chrome.storage.local.set({
      [STATS_KEY]: { ...current, installedAt: Date.now() },
    });
  }
}

/**
 * Voeg milestone-IDs toe aan unlockedMilestones (idempotent, geset-ificeerd).
 * Caller roept eerst computeNewUnlocks() uit milestones/index.ts aan, geeft
 * de IDs hier door om persistent te maken.
 *
 * v0.2.0: nieuw voor milestones-feature (#83).
 */
export async function unlockMilestones(ids: string[]): Promise<LocalStats> {
  if (ids.length === 0) {
    return getStats();
  }
  const current = await getStats();
  const merged = new Set([...current.unlockedMilestones, ...ids]);
  const next: LocalStats = { ...current, unlockedMilestones: [...merged] };
  await chrome.storage.local.set({ [STATS_KEY]: next });
  return next;
}

/**
 * Markeer milestones als ontgrendeld én als "wacht op celebration".
 * Background roept dit aan na elke banner-block-event als computeNewUnlocks
 * iets retourneerde. Popup verwerkt pendingCelebrations zodra hij opent.
 *
 * v0.2.0: nieuw voor celebration card (#86).
 */
export async function markUnlockedAndPending(ids: string[]): Promise<LocalStats> {
  if (ids.length === 0) {
    return getStats();
  }
  const current = await getStats();
  const unlockedMerged = new Set([...current.unlockedMilestones, ...ids]);
  const pendingMerged = new Set([...current.pendingCelebrations, ...ids]);
  const next: LocalStats = {
    ...current,
    unlockedMilestones: [...unlockedMerged],
    pendingCelebrations: [...pendingMerged],
  };
  await chrome.storage.local.set({ [STATS_KEY]: next });
  return next;
}

/**
 * Verwijder één milestone-ID uit pendingCelebrations (na popup-dismiss).
 *
 * v0.2.0: nieuw voor celebration card (#86).
 */
export async function clearPendingCelebration(id: string): Promise<LocalStats> {
  const current = await getStats();
  if (!current.pendingCelebrations.includes(id)) {
    return current;
  }
  const next: LocalStats = {
    ...current,
    pendingCelebrations: current.pendingCelebrations.filter((x) => x !== id),
  };
  await chrome.storage.local.set({ [STATS_KEY]: next });
  return next;
}
