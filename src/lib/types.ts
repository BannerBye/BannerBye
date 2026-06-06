/**
 * BannerBye — shared types
 *
 * Zo min mogelijk types in één plek; alleen wat door meerdere
 * entrypoints (background/content/popup) gebruikt wordt.
 */

/**
 * Globale instellingen, gesynced via chrome.storage.sync.
 *
 * Sync staat aan zodat je per-site pause-keuzes meegaan tussen
 * apparaten van dezelfde gebruiker (Chrome/Firefox/Safari sync).
 * Limiet van sync-storage is 100 KB — ruim voldoende.
 */
export interface SyncedSettings {
  /** Globale on/off. Default: true. */
  enabled: boolean;
  /** Hostnames waar BannerBye gepauzeerd is (bijv. "bank.example.com"). */
  pausedSites: string[];
  /** Of de welkomst-flow al getoond is. Voorkomt dubbele onboarding op nieuw device. */
  onboardingCompleted: boolean;
}

/**
 * Lokale stats per device. Niet gesynced — anders telt elke device dubbel.
 * Ook bewust beperkt: alleen geaggregeerde counter, geen URL-log.
 *
 * v0.2.0: unlockedMilestones tracket welke milestone-IDs deze device al
 * heeft gehaald (zie src/lib/milestones/). Append-only — eenmaal unlocked,
 * blijft unlocked. pendingCelebrations bevat de subset die de gebruiker
 * nog niet als celebration card heeft gezien.
 */
export interface LocalStats {
  /** Cumulatief aantal banners voorkomen op dit device. */
  blocked: number;
  /** Timestamp van eerste install (ms sinds epoch). */
  installedAt: number;
  /** v0.2.0: IDs van milestones die deze device al heeft ontgrendeld. */
  unlockedMilestones: string[];
  /** v0.2.0: IDs van milestones waarvoor we de celebration card nog moeten tonen. */
  pendingCelebrations: string[];
}

/**
 * Status voor de huidige tab, berekend in de popup.
 * Wordt niet opgeslagen — afgeleid van URL + settings.
 */
export interface TabStatus {
  hostname: string;
  isPaused: boolean;
  /** True als BannerBye op deze tab actief signal heeft gestuurd. */
  signalSent: boolean;
}

export const DEFAULT_SETTINGS: SyncedSettings = {
  enabled: true,
  pausedSites: [],
  onboardingCompleted: false,
};

export const DEFAULT_STATS: LocalStats = {
  blocked: 0,
  installedAt: 0,
  unlockedMilestones: [],
  pendingCelebrations: [],
};
