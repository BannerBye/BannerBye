/**
 * @bannerbye/refuse — refuse(page).
 *
 *   import { chromium } from 'playwright';
 *   import { prepare, refuse } from '@bannerbye/refuse';
 *
 *   const browser = await chromium.launch();
 *   const context = await browser.newContext();
 *   await prepare(context);                 // TCF-weigerstring + GPC vóór elke pagina
 *   const page = await context.newPage();
 *   await page.goto('https://example.org');
 *   const result = await refuse(page);      // klikt "Reject all", ook achter "Manage settings"
 *   console.log(result.outcome);            // 'refused' | 'clean' | 'unresolved'
 *
 * Dit is de motor van de BannerBye-extensie (bannerbye.com) zonder de
 * extensie eromheen: dezelfde zoeker, dezelfde sleutelwoorden in 50+ talen,
 * dezelfde structurele bannercheck. Bedoeld voor scrapers, testsuites en
 * agents die een pagina willen lezen in plaats van een banner.
 */
import type { PageLike, PreparableLike, RefuseClick, RefuseOptions, RefuseResult } from './types.ts';

export type { PageLike, PreparableLike, RefuseClick, RefuseOptions, RefuseOutcome, RefuseResult } from './types.ts';

declare const __BB_INPAGE_SOURCE__: string;
declare const __BB_INIT_SOURCE__: string;

/** Broncode van het in-page script (IIFE). Handig als je 'm zelf wilt injecteren. */
export const INPAGE_SOURCE: string = __BB_INPAGE_SOURCE__;
/** Broncode van het document_start-script (IIFE): TCF-weigerstring + GPC. */
export const INIT_SOURCE: string = __BB_INIT_SOURCE__;

/**
 * Zet het document_start-script en de Sec-GPC-header op een Playwright
 * BrowserContext/Page of een Puppeteer Page. Eén keer per context.
 */
export async function prepare(target: PreparableLike): Promise<void> {
  if (typeof target.addInitScript === 'function') {
    await target.addInitScript({ content: INIT_SOURCE });
  } else if (typeof target.evaluateOnNewDocument === 'function') {
    await target.evaluateOnNewDocument(INIT_SOURCE);
  } else {
    throw new Error('prepare(): target has neither addInitScript (Playwright) nor evaluateOnNewDocument (Puppeteer)');
  }
  if (typeof target.setExtraHTTPHeaders === 'function') {
    try {
      await target.setExtraHTTPHeaders({ 'Sec-GPC': '1' });
    } catch {
      // Sommige drivers staan dit niet toe op een Page; de init-script-kant werkt dan nog.
    }
  }
}

interface StepResult {
  action: 'reject' | 'stepInto' | 'none';
  label: string | null;
  bannerPresent: boolean;
  signals: string[];
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function framesOf(page: PageLike, includeFrames: boolean): PageLike[] {
  if (!includeFrames || typeof page.frames !== 'function') return [page];
  try {
    const all = page.frames();
    const main = typeof page.mainFrame === 'function' ? page.mainFrame() : all[0];
    // Hoofdframe eerst; de rest in documentvolgorde.
    return [main, ...all.filter((f) => f !== main)].filter(Boolean) as PageLike[];
  } catch {
    return [page];
  }
}

async function ensureInjected(frame: PageLike): Promise<boolean> {
  try {
    const has = await frame.evaluate('typeof window.__bannerbyeRefuse === "object"');
    if (!has) await frame.evaluate(INPAGE_SOURCE);
    return true;
  } catch {
    return false; // cross-origin / gesloten frame
  }
}

async function stepIn(frame: PageLike): Promise<StepResult | null> {
  try {
    return (await frame.evaluate('window.__bannerbyeRefuse.step()')) as StepResult;
  } catch {
    return null;
  }
}

/**
 * Weigert de cookiebanner op `page`. Zoekt een weigerknop, en als die
 * ontbreekt eerst een instellingenknop ("Manage settings") en daarachter
 * alsnog de weigerknop. Lost op zodra de banner weg is, er na
 * `cleanAfterMs` geen banner was, of de timeout verstrijkt.
 */
export async function refuse(page: PageLike, options: RefuseOptions = {}): Promise<RefuseResult> {
  const timeoutMs = options.timeoutMs ?? 8000;
  const pollMs = options.pollMs ?? 250;
  const settleMs = options.settleMs ?? 600;
  const cleanAfterMs = options.cleanAfterMs ?? 1500;
  const includeFrames = options.frames ?? true;

  const t0 = Date.now();
  const clicks: RefuseClick[] = [];
  let bannerSignals: string[] = [];
  let everSawBanner = false;
  let tcfPrepared = false;
  try {
    tcfPrepared = (await page.evaluate('!!(window.__bannerbyeInit)')) === true;
  } catch {
    // negeren
  }

  const frameName = (f: PageLike): string => {
    try {
      return typeof f.name === 'function' ? f.name() || 'main' : 'main';
    } catch {
      return 'main';
    }
  };

  while (Date.now() - t0 < timeoutMs) {
    let bannerNow = false;
    let rejected = false;
    for (const frame of framesOf(page, includeFrames)) {
      if (!(await ensureInjected(frame))) continue;
      const r = await stepIn(frame);
      if (!r) continue;
      if (r.bannerPresent) {
        bannerNow = true;
        everSawBanner = true;
        if (r.signals.length) bannerSignals = r.signals;
      }
      if (r.action !== 'none') {
        clicks.push({ action: r.action, label: r.label ?? '', frame: frameName(frame), atMs: Date.now() - t0 });
        await sleep(settleMs);
        if (r.action === 'reject') rejected = true;
        break; // één klik per ronde; daarna opnieuw kijken
      }
    }

    if (rejected) {
      // Is de banner nu weg?
      let stillThere = false;
      for (const frame of framesOf(page, includeFrames)) {
        if (!(await ensureInjected(frame))) continue;
        try {
          const s = (await frame.evaluate('window.__bannerbyeRefuse.scan()')) as { bannerPresent: boolean };
          if (s.bannerPresent) stillThere = true;
        } catch {
          // frame weg = banner weg
        }
      }
      if (!stillThere) return done('refused');
      // Nog zichtbaar: misschien een tweede knop (bv. "Bevestig"). Doorzoeken.
      continue;
    }

    if (!bannerNow && !everSawBanner && Date.now() - t0 >= cleanAfterMs) return done('clean');
    await sleep(pollMs);
  }

  return done(everSawBanner ? 'unresolved' : 'clean');

  function done(outcome: RefuseResult['outcome']): RefuseResult {
    let url = '';
    try {
      url = page.url();
    } catch {
      // negeren
    }
    let host = '';
    try {
      host = new URL(url).hostname;
    } catch {
      // negeren
    }
    return { outcome, url, host, clicks, bannerSignals, ms: Date.now() - t0, tcfPrepared };
  }
}
