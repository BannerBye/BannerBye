/**
 * BannerBye — milestones lib (v0.2.0)
 *
 * Centrale lijst van milestone-definities + helper voor unlock-check.
 *
 * Hoe het werkt:
 *  1. Background (of popup) roept `computeNewUnlocks(stats)` aan na
 *     elke counter-bump of bij popup-open.
 *  2. De helper vergelijkt huidige stats tegen MILESTONES, retourneert
 *     de net-unlocked ones die nog niet in stats.unlockedMilestones zaten.
 *  3. Caller voegt de nieuwe IDs aan stats.unlockedMilestones toe en
 *     toont een celebration card.
 *
 * Pure functie, geen storage-toegang — caller regelt de persistence.
 */

import type { LocalStats } from '../types.ts';
import type { Milestone } from './types.ts';

export type { Milestone, MilestoneThreshold } from './types.ts';

/**
 * Alle milestones, in volgorde van eerste unlock.
 *
 * Belangrijk: het `id`-veld is stable voor opslag — een gebruiker met
 * `unlockedMilestones: ['first-banner']` blijft "Pop your first" zien,
 * ook als wij de display-naam later herschrijven. NOOIT id's veranderen.
 */
export const MILESTONES: readonly Milestone[] = [
  { id: 'first-banner',       threshold: { type: 'banners', count: 1 },      name: 'Pop your first' },
  { id: 'first-steps',        threshold: { type: 'banners', count: 10 },     name: 'First steps' },
  { id: 'cookie-crusher',     threshold: { type: 'banners', count: 100 },    name: 'Cookie crusher' },
  { id: 'banner-bye-master',  threshold: { type: 'banners', count: 1000 },   name: 'Banner bye-bye master' },
  { id: 'privacy-champion',   threshold: { type: 'banners', count: 10000 },  name: 'Privacy champion' },
  { id: 'cookie-diet-month',  threshold: { type: 'days', count: 30 },        name: 'Cookie diet · month one' },
  { id: 'cookie-diet-year',   threshold: { type: 'days', count: 365 },       name: 'Cookie diet · year one' },
];

/**
 * Aantal dagen sinds install, afgeleid van stats.installedAt en `now`.
 *
 * Returnt 0 als installedAt nog niet gezet is (0). Gebruikt millisecond-
 * arithmetic; afgerond naar beneden zodat "30 dagen" pas trigger bij
 * 30 volle dagen, niet bij 29 + een beetje.
 */
export function daysSinceInstall(stats: LocalStats, now: number = Date.now()): number {
  if (!stats.installedAt) return 0;
  const elapsedMs = now - stats.installedAt;
  if (elapsedMs <= 0) return 0;
  return Math.floor(elapsedMs / (1000 * 60 * 60 * 24));
}

/**
 * Check of een milestone met huidige stats unlocked zou moeten zijn.
 */
function isUnlocked(milestone: Milestone, stats: LocalStats, now: number): boolean {
  switch (milestone.threshold.type) {
    case 'banners':
      return stats.blocked >= milestone.threshold.count;
    case 'days':
      return daysSinceInstall(stats, now) >= milestone.threshold.count;
  }
}

/**
 * Bereken welke milestones nét-nu unlocked zijn, maar nog niet in
 * stats.unlockedMilestones staan. Pure functie — caller is verantwoordelijk
 * voor het toevoegen aan stats + persisteren.
 *
 * Returnt een array (kan leeg zijn) van net-ontgrendelde milestones.
 * Bij eerste install van een power-user die meteen 100 banners weert:
 * meerdere milestones tegelijk unlocken. Caller toont ze sequentieel
 * of als groep.
 */
export function computeNewUnlocks(
  stats: LocalStats,
  now: number = Date.now(),
): Milestone[] {
  const already = new Set(stats.unlockedMilestones ?? []);
  return MILESTONES.filter(
    (m) => isUnlocked(m, stats, now) && !already.has(m.id),
  );
}

/**
 * Lookup-helper voor de UI: geef Milestone-definition by id, of undefined
 * als 'm niet bestaat (= verwijderd uit MILESTONES sinds opslag).
 */
export function getMilestoneById(id: string): Milestone | undefined {
  return MILESTONES.find((m) => m.id === id);
}
