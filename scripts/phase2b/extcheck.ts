/**
 * Pijplijn v3 (nov 2026) — hetzelfde bezoek nog een keer, nu met de echte
 * extensie geladen.
 *
 * De rest van de pijplijn kijkt naar de site zonder BannerBye: is er een
 * banner, welke knoppen staan erin. Dat beantwoordt niet de vraag van de
 * melder ("BannerBye doet het hier niet"). De meeste gemiste bugs van
 * okt/nov 2026 waren extensiegedrag: twinseasons.de (knop herkend, klik deed
 * niets), duckduckgo.com en reactormag.com (herlaadlus), raiplay.it (laag 5
 * stond uit door het TCF-antwoord). Die zie je alleen met de extensie erin.
 *
 * Wat deze check oplevert (zie ExtensionCheck in verdict.ts):
 *   - bannerStill: na het wachten is de banner nog zichtbaar → BannerBye
 *     weigerde hier niet. Bewijs dat er iets mis is (tenzij de site een
 *     muur of echt accept-only is; dat beslist verdict.ts).
 *   - loop: te veel hoofdframe-navigaties → herlaadlus. Altijd een bug.
 * Een geslaagde check ("banner weg") sluit NOOIT een melding: de melder zat
 * misschien op Safari/iOS of in een ander land. Het is alleen bewijs ervóór.
 *
 * De workflow bouwt de Chrome-extensie (.output/chrome-mv3) en geeft het pad
 * mee via BB_EXTENSION_PATH. Ontbreekt dat, of laadt de extensie niet, dan
 * is ran=false en telt de check nergens mee.
 */

import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import type { ExtensionCheck } from './verdict.ts';

/** Zelfde drempel als de herlaadrem in de extensie (lib/reload-brake.ts): 10 in 10 s. */
export const LOOP_NAVIGATIONS = 8;

export interface ExtProfile {
  userAgent: string;
  viewport: { width: number; height: number };
  locale: string;
  isMobile: boolean;
  hasTouch: boolean;
  deviceScaleFactor: number;
}

export function extensionPath(): string | null {
  const p = process.env.BB_EXTENSION_PATH;
  if (!p) return null;
  return existsSync(join(p, 'manifest.json')) ? p : null;
}

export async function checkWithExtension(
  url: string,
  profile: ExtProfile,
  detectScript: string,
  opts: { waitMs?: number; navTimeoutMs?: number } = {},
): Promise<ExtensionCheck> {
  const ext = extensionPath();
  if (!ext) return { ran: false, bannerStill: false, navigations: 0, loop: false, note: 'extensie niet gebouwd' };

  const dir = await mkdtemp(join(tmpdir(), 'bb-ext-'));
  let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | null = null;
  try {
    // channel 'chromium' = de nieuwe headless-modus, die extensies wél laadt.
    context = await chromium.launchPersistentContext(dir, {
      channel: 'chromium',
      headless: true,
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--no-sandbox'],
      userAgent: profile.userAgent,
      viewport: profile.viewport,
      locale: profile.locale,
      isMobile: profile.isMobile,
      hasTouch: profile.hasTouch,
      deviceScaleFactor: profile.deviceScaleFactor,
      extraHTTPHeaders: { 'Accept-Language': `${profile.locale},${profile.locale.slice(0, 2)};q=0.9,en;q=0.7` },
    });

    // Draait de service worker van BannerBye? Zonder die is dit geen extensiecheck.
    let worker = context.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://'));
    if (!worker) {
      worker = await context
        .waitForEvent('serviceworker', { timeout: 8000 })
        .then((w) => (w.url().startsWith('chrome-extension://') ? w : undefined))
        .catch(() => undefined);
    }
    if (!worker) {
      return { ran: false, bannerStill: false, navigations: 0, loop: false, note: 'extensie laadde niet (geen service worker)' };
    }

    // Onboarding-tab sluiten zodat die niets beïnvloedt.
    for (const p of context.pages()) await p.close().catch(() => undefined);

    const page = await context.newPage();
    let navigations = 0;
    page.on('framenavigated', (f) => {
      if (f === page.mainFrame()) navigations++;
    });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: opts.navTimeoutMs ?? 20000 });
    // Ruim wachten: laag 5 heeft een eigen timeout en de motor (laag 3) kan
    // een paar seconden nodig hebben.
    await page.waitForTimeout((opts.waitMs ?? 3500) + 6000);
    const loop = navigations >= LOOP_NAVIGATIONS;
    let bannerStill = false;
    try {
      const det = (await page.evaluate(detectScript)) as { bannerVisible?: boolean };
      bannerStill = !!det?.bannerVisible;
    } catch {
      // Pagina navigeerde midden in de evaluatie: bij een lus verwacht.
    }
    const note = loop
      ? `herlaadlus: ${navigations} navigaties`
      : bannerStill
        ? 'banner bleef staan met BannerBye actief'
        : 'banner verdween met BannerBye actief (Chromium)';
    return { ran: true, bannerStill, navigations, loop, note };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ran: false, bannerStill: false, navigations: 0, loop: false, note: `extensiecheck faalde: ${msg.slice(0, 120)}` };
  } finally {
    if (context) await context.close().catch(() => undefined);
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
