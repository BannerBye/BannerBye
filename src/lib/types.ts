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
  /**
   * v0.3.0: hostnames die de gebruiker als kapot heeft gemeld en die we nog
   * "in de gaten houden" — puur lokaal, geen tracking, geen server-koppeling.
   * Zodra BannerBye op zo'n host alsnog een banner blokkeert, geldt de melding
   * als opgelost en tonen we een celebration card (#reward-1). Gecapt op de
   * meest recente REPORTED_SITES_CAP hosts.
   */
  reportedSites: string[];
  /**
   * v0.3.0: gemelde hosts waarvoor we de "jouw melding is nu gekild"-card nog
   * moeten tonen. Subset-flow gelijk aan pendingCelebrations, maar per hostname.
   */
  pendingReportFixed: string[];
  /**
   * v0.4.0: recente activiteit per host — het "bewijs" achter de teller.
   *
   * PRIVACY: dit is de enige plek waar BannerBye bijhoudt wélke sites je
   * bezocht. Bewust ingeperkt: één regel per host (geen bezoeklog), maximaal
   * ACTIVITY_CAP hosts, automatisch vervallen na ACTIVITY_TTL_MS, blijft
   * uitsluitend in `chrome.storage.local` en gaat nooit mee in een melding of
   * naar een server. De gebruiker kan de lijst met één tik wissen.
   */
  recentActivity: ActivityEntry[];
}

/** Uitkomst van BannerBye op één host. */
export type ActivityOutcome = 'refused' | 'clean';

/**
 * Eén regel in de activiteitenlijst. Bewust per host samengevat in plaats van
 * per paginabezoek — dat maakt het een overzicht van waar BannerBye werkte,
 * niet een tijdlijn van wat je gelezen hebt.
 */
export interface ActivityEntry {
  /** Genormaliseerde hostname, bijvoorbeeld "zalando.nl". */
  host: string;
  /** Herkend consent-platform, indien bekend. Bijvoorbeeld "IAB TCF". */
  platform?: string;
  /** 'refused' = banner geweigerd · 'clean' = geen banner aangetroffen. */
  outcome: ActivityOutcome;
  /** Laatste keer dat dit gebeurde (ms sinds epoch). */
  lastAt: number;
  /** Hoe vaak op deze host, sinds de regel bestaat. */
  count: number;
}

/** Maximaal aantal hosts in de activiteitenlijst. */
export const ACTIVITY_CAP = 40;

/** Hoe lang een regel blijft staan: zeven dagen. */
export const ACTIVITY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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
  reportedSites: [],
  pendingReportFixed: [],
  recentActivity: [],
};
