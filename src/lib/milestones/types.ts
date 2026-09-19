/**
 * BannerBye — milestone-types (v0.2.0)
 *
 * Engagement-feature die de gebruiker iconische momenten geeft —
 * "Pop your first" bij eerste banner, "Cookie diet · year one"
 * bij 365 dagen actief. Doel: subtiele beloning, geen casino-UX.
 *
 * Twee soorten triggers:
 *  - 'banners': cumulatieve geblokeerde-banner-teller (stats.blocked)
 *  - 'days':    dagen sinds installatie (now - stats.installedAt)
 *
 * Milestone-status wordt persistent opgeslagen in LocalStats.
 * unlockedMilestones. Eenmaal unlocked, blijft 'ie unlocked — ook
 * als de gebruiker BannerBye opnieuw installeert (storage.sync zou
 * het bewaren, mits we ze daar zetten — maar LocalStats is per
 * device. Voor v0.2.0 acceptabel: één milestone per device).
 */

/**
 * De voorwaarde waaronder een milestone ontgrendelt.
 */
export type MilestoneThreshold =
  | { type: 'banners'; count: number }
  | { type: 'days'; count: number };

/**
 * Een unlockable milestone-definitie.
 *
 * `id` is stable identifier voor opslag (verandert nooit, ook al
 * herschrijven we de naam later). `name` is de Engelse brontekst
 * (fallback/documentatie). `nameKey` is de messages.json-sleutel die de
 * UI daadwerkelijk toont via `t()` — vertaalronde 19-09-2026 (fix i18n).
 */
export interface Milestone {
  /** Stable identifier voor opslag. Veranderen we nooit meer. */
  id: string;
  /** Wanneer hij ontgrendelt. */
  threshold: MilestoneThreshold;
  /** Engelse brontekst — alleen fallback/documentatie, niet tonen in UI. */
  name: string;
  /** messages.json-sleutel voor de daadwerkelijk getoonde, vertaalde naam. */
  nameKey: string;
}
