/**
 * BannerBye — herlaadrem (v0.4.8, bouwpunt 4 uit het productonderzoek van
 * 5 oktober 2026).
 *
 * Drie keer in een half jaar is een site in een herlaadlus beland door
 * een van onze lagen: heise.de (#204, `useractioncomplete`), de
 * CMP-reload-guard in cmp.content.ts en duckduckgo.com (#310, step-into
 * klikte een navigerende link). Elke keer was de oorzaak anders, elke keer
 * was de fix een nieuwe, specifieke rem — en elke keer zat de gebruiker
 * intussen vast in een pagina die niet meer stilstond ("Loop of Doom…
 * can only be stopped by force stopping", melding 4 okt).
 *
 * Dit is de algemene rem die boven alle lagen hangt: het background-script
 * telt per tab hoe vaak dezelfde host in korte tijd opnieuw laadt. Boven
 * de drempel zet het die host op de gewone pauzelijst (dezelfde weg als
 * "Pause on this site" in de popup — dus álle lagen gaan uit op die host,
 * op elk platform, zonder nieuwe codepaden) en onthoudt het lokaal wáárom,
 * zodat de popup het kan uitleggen en één tik volstaat om te hervatten of
 * te melden.
 *
 * Wat de rem bewust NIET doet:
 *  - Zelf melden. Niets verlaat het apparaat zonder dat de gebruiker op
 *    "Report broken site" tikt (privacybelofte, zie /privacy).
 *  - Voor altijd pauzeren. Een rem-pauze verloopt na STORM_PAUSE_TTL_MS en
 *    wordt bij een browserstart opgeruimd als hij ouder is dan
 *    STORM_PAUSE_RESTART_MIN_AGE_MS — er kan intussen een fix zijn
 *    uitgerold via rules.json of een nieuwe versie.
 *  - Vaststellen of de lus van óns is. Dat kan het background niet weten;
 *    het kan alleen de gok doen die de gebruiker zelf ook zou doen
 *    ("probeer het eens zonder BannerBye"). Blijft de pagina ook zonder ons
 *    herladen, dan is de pauze onschuldig en is de uitleg in de popup
 *    alsnog nuttig.
 *
 * Drempel: STORM_THRESHOLD herladingen binnen STORM_WINDOW_MS. De echte
 * lussen zaten ver daarboven (duckduckgo.com: 514 navigaties in 12 s;
 * heise.de: ~3 per seconde) en worden dus binnen een paar seconden
 * gestopt. Een mens die F5 inhamert haalt 10 in 10 s zelden — en krijgt
 * dan een popup met uitleg en een hervat-knop, geen stil falen.
 */

import { normalizeHost } from './host.ts';
import { getSettings, setPausedForSite } from './storage.ts';

/** Tijdvenster waarbinnen herladingen meetellen. */
export const STORM_WINDOW_MS = 10_000;
/** Aantal herladingen van dezelfde host in één tab binnen het venster. */
export const STORM_THRESHOLD = 10;
/** Een rem-pauze verloopt vanzelf na een dag. */
export const STORM_PAUSE_TTL_MS = 24 * 60 * 60 * 1000;
/**
 * Bij een browserstart ruimen we rem-pauzes op die ouder zijn dan dit.
 * Jongere pauzes blijven staan: wie de browser herstart ómdat een pagina
 * bleef herladen, moet niet meteen weer in dezelfde lus belanden.
 */
export const STORM_PAUSE_RESTART_MIN_AGE_MS = 60 * 60 * 1000;

/** Opslagsleutel in chrome.storage.local. */
export const STORM_PAUSES_KEY = 'stormPauses';

export interface StormPause {
  /** Wanneer de rem ingreep (ms sinds epoch). */
  at: number;
  /** Tot wanneer de pauze geldt (ms sinds epoch). */
  until: number;
  /** Aantal herladingen dat de rem zag toen hij ingreep. */
  loads: number;
}

export type StormPauses = Record<string, StormPause>;

/* ── opslag ───────────────────────────────────────────────────── */

export async function getStormPauses(): Promise<StormPauses> {
  try {
    const result = await chrome.storage.local.get(STORM_PAUSES_KEY);
    const stored = result[STORM_PAUSES_KEY];
    return stored && typeof stored === 'object' ? (stored as StormPauses) : {};
  } catch {
    return {};
  }
}

async function setStormPauses(next: StormPauses): Promise<void> {
  await chrome.storage.local.set({ [STORM_PAUSES_KEY]: next });
}

/**
 * Zet een host op de pauzelijst én onthoud dat de rem dat deed.
 * Idempotent: een host die al gepauzeerd is (door de gebruiker of de rem)
 * wordt niet nogmaals aangeraakt.
 */
export async function applyStormPause(host: string, loads: number): Promise<boolean> {
  const settings = await getSettings();
  if (!settings.enabled) return false;
  if (settings.pausedSites.includes(host)) return false;

  const now = Date.now();
  const pauses = await getStormPauses();
  pauses[host] = { at: now, until: now + STORM_PAUSE_TTL_MS, loads };
  await setStormPauses(pauses);
  await setPausedForSite(host, true);
  return true;
}

/** Vergeet dat de rem deze host pauzeerde (de pauze zelf blijft/vervalt los hiervan). */
export async function clearStormPause(host: string): Promise<void> {
  const pauses = await getStormPauses();
  if (!(host in pauses)) return;
  delete pauses[host];
  await setStormPauses(pauses);
}

/**
 * Ruim verlopen rem-pauzes op en haal die hosts van de pauzelijst.
 * `minAgeMs` laat alles jonger dan die leeftijd staan (zie
 * STORM_PAUSE_RESTART_MIN_AGE_MS).
 */
export async function pruneStormPauses(opts: { minAgeMs?: number; all?: boolean } = {}): Promise<string[]> {
  const pauses = await getStormPauses();
  const hosts = Object.keys(pauses);
  if (hosts.length === 0) return [];

  const now = Date.now();
  const released: string[] = [];
  for (const host of hosts) {
    const p = pauses[host];
    if (!p) continue;
    const expired = p.until <= now;
    const oldEnough = opts.minAgeMs !== undefined && now - p.at >= opts.minAgeMs;
    if (opts.all || expired || oldEnough) {
      delete pauses[host];
      released.push(host);
    }
  }
  if (released.length === 0) return [];

  await setStormPauses(pauses);
  for (const host of released) {
    try {
      await setPausedForSite(host, false);
    } catch {
      // Sync-opslag even niet beschikbaar — de TTL blijft staan, volgende
      // prune probeert het opnieuw.
    }
  }
  return released;
}

/* ── teller (alleen in het background, in-memory) ─────────────── */

interface TabLoads {
  host: string;
  /** Tijdstippen van de laatste herladingen binnen het venster. */
  times: number[];
  /** Host waarvoor de rem in deze tab al ingreep — niet opnieuw tellen. */
  braked: string | null;
}

export class ReloadBrake {
  private readonly tabs = new Map<number, TabLoads>();

  /**
   * Registreer een hoofdframe-navigatie. Geeft het aantal herladingen in het
   * venster terug als de drempel zojuist is bereikt, anders 0. Alleen http(s).
   */
  note(tabId: number, url: string | undefined, now = Date.now()): { host: string; loads: number } | null {
    if (!url || !/^https?:/i.test(url)) return null;
    const host = normalizeHost(url);
    if (!host) return null;

    let entry = this.tabs.get(tabId);
    if (!entry || entry.host !== host) {
      entry = { host, times: [], braked: null };
      this.tabs.set(tabId, entry);
    }
    if (entry.braked === host) return null;

    entry.times.push(now);
    const cutoff = now - STORM_WINDOW_MS;
    while (entry.times.length > 0 && (entry.times[0] ?? now) < cutoff) entry.times.shift();

    if (entry.times.length >= STORM_THRESHOLD) {
      entry.braked = host;
      const loads = entry.times.length;
      entry.times = [];
      return { host, loads };
    }
    return null;
  }

  /** De gebruiker hervatte op deze host — laat de rem er weer op letten. */
  release(host: string): void {
    for (const entry of this.tabs.values()) {
      if (entry.braked === host) entry.braked = null;
    }
  }

  forget(tabId: number): void {
    this.tabs.delete(tabId);
  }
}
