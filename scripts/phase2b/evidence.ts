/**
 * Pijplijn v2 (0.4.17) — pure helpers rond het bewijs van de melder, los van
 * Playwright zodat ze zonder browser te testen zijn (test-evidence.ts).
 */

import type { DetectionResult } from './detect.ts';
import type { HostWork, ReportSnapshot } from './redis.ts';

/** Alleen een kaal pad; alles wat op query/hash/whitespace lijkt wordt '/'. */
export function safePath(path: string | undefined): string {
  if (!path || !path.startsWith('/') || /[?#\s]/.test(path) || path.length > 200) return '/';
  return path;
}

/**
 * Zet de snapshot van de melder om in dezelfde vorm als een headless-detectie,
 * zodat classify() er ongewijzigd op kan draaien. Null als het bewijs te mager
 * is (geen kandidaten, of geen herkende container én geen bannertekst).
 */
export function detectionFromSnapshot(host: string, work: Pick<HostWork, 'path'>, snap: ReportSnapshot): DetectionResult | null {
  const inBanner = snap.candidates.filter((c) => c.inBanner);
  const pool = inBanner.length ? inBanner : snap.candidates;
  if (!pool.length) return null;
  if (!snap.bannerFound && !snap.bannerText) return null;
  return {
    finalUrl: `https://${host}${safePath(work.path)}`,
    cmps: snap.cmps,
    hasTcf: false,
    bannerVisible: true,
    candidates: pool.map((c) => ({ text: c.text, tag: c.tag })),
    bannerTextSnippet: snap.bannerText.slice(0, 300),
    weakSignal: !snap.bannerFound,
    pageLang: snap.pageLang,
  };
}
