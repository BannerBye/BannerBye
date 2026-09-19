/**
 * BannerBye — share-card canvas generator (v0.2.0, #87)
 *
 * Render een 1200x630 PNG (social-media OG-formaat) die de gebruiker bij
 * een unlocked milestone kan delen of downloaden. Pure client-side, geen
 * server. Werkt vanuit popup-context (document + canvas zijn beschikbaar).
 *
 * Layout:
 *   - Cream achtergrond (#FAF7F0)
 *   - Subtle ember accent strip aan top
 *   - Wordmark "BannerBye" links boven
 *   - Milestone-naam groot in het midden
 *   - "X cookie banners refused" sub-text
 *   - "Cookie banners, killed. Before they load." brand-tagline onder
 *   - "bannerbye.com" voet
 *
 * Fonts: system fonts (Helvetica/Arial fallback) — Google Fonts laden
 * vanuit popup-canvas geeft race-conditions. Brand-consistency niet 100%
 * maar herkenbaar genoeg voor share-context.
 */

import type { Milestone } from '../milestones/types.ts';
import { MILESTONES } from '../milestones/index.ts';
import { t } from '../i18n/t.ts';

// v0.4.5 (vertaalronde 19-09-2026): alle canvas-tekst loopt nu via t().
// Bekende beperking: canvas 2D text-rendering doet geen bidi/RTL-reshaping.
// Voor Arabisch/Hebreeuws/Urdu/Perzisch kan de tekstrichting hierdoor visueel
// fout ogen op de gedownloade PNG — een DOM-gebaseerde kaart zou dit correct
// renderen, canvas niet. Geaccepteerde beperking voor v1 van deze vertaalronde.

const WIDTH = 1200;
const HEIGHT = 630;

const COLOR_CREAM = '#FAF7F0';
const COLOR_INK = '#0E1116';
const COLOR_EMBER = '#E85A2C';
const COLOR_SMOKE = '#6B7077';

/**
 * Genereer een share-card image en return een PNG data-URL.
 *
 * Caller (popup) kan de dataURL gebruiken om te downloaden via een
 * tijdelijke `<a download href={url}>` of in een modal te previewen.
 */
export function generateShareCard(
  milestone: Milestone,
  blockedCount: number,
): string {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context unavailable');
  }

  // === BACKGROUND ===
  ctx.fillStyle = COLOR_CREAM;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Subtle ember strip aan top voor accent.
  ctx.fillStyle = COLOR_EMBER;
  ctx.fillRect(0, 0, WIDTH, 8);

  // === WORDMARK ===
  ctx.textBaseline = 'top';
  ctx.font = '600 48px "Helvetica Neue", "Arial", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = COLOR_INK;
  ctx.fillText('Banner', 80, 64);
  // "Bye" in ember, offset rechts van "Banner".
  const bannerWidth = ctx.measureText('Banner').width;
  ctx.fillStyle = COLOR_EMBER;
  ctx.fillText('Bye', 80 + bannerWidth, 64);

  // === MILESTONE LABEL ===
  ctx.textAlign = 'center';
  ctx.font = '500 22px "JetBrains Mono", "Menlo", monospace';
  ctx.fillStyle = COLOR_SMOKE;
  ctx.fillText(t('share_milestone_unlocked_label'), WIDTH / 2, 220);

  // === MILESTONE NAAM ===
  // Auto-scale font op basis van lengte van de vertaalde naam zodat lange
  // teksten (in sommige talen langer dan het Engelse origineel) niet de
  // canvas overlopen.
  const milestoneName = t(milestone.nameKey);
  ctx.fillStyle = COLOR_INK;
  let nameSize = 96;
  ctx.font = `700 ${nameSize}px "Helvetica Neue", "Arial", sans-serif`;
  while (ctx.measureText(milestoneName).width > WIDTH - 160 && nameSize > 48) {
    nameSize -= 4;
    ctx.font = `700 ${nameSize}px "Helvetica Neue", "Arial", sans-serif`;
  }
  ctx.fillText(milestoneName, WIDTH / 2, 270);

  // === COUNTER ===
  ctx.font = '400 32px "Helvetica Neue", "Arial", sans-serif';
  ctx.fillStyle = COLOR_SMOKE;
  const countStr = blockedCount.toLocaleString('en-US');
  const counterText = t(
    blockedCount === 1 ? 'share_counter_singular' : 'share_counter_plural',
    countStr,
  );
  ctx.fillText(counterText, WIDTH / 2, 400);

  // === TAGLINE ===
  ctx.font = '500 24px "Helvetica Neue", "Arial", sans-serif';
  ctx.fillStyle = COLOR_INK;
  ctx.fillText(t('share_tagline'), WIDTH / 2, 500);

  // === URL ===
  ctx.font = '500 20px "JetBrains Mono", "Menlo", monospace';
  ctx.fillStyle = COLOR_SMOKE;
  ctx.fillText('bannerbye.com', WIDTH / 2, 558);

  return canvas.toDataURL('image/png');
}

/**
 * Trigger een download van de share-card. Gebruikt een tijdelijke
 * `<a download>` link omdat dat de meest compatible cross-browser
 * download-trigger is vanuit extension-popup.
 */
export function downloadShareCard(
  milestone: Milestone,
  blockedCount: number,
): void {
  const dataUrl = generateShareCard(milestone, blockedCount);
  triggerDownload(dataUrl, `bannerbye-${milestone.id}.png`);
}

/**
 * Genereer een "Year in BannerBye" stats-share-card (#88).
 *
 * Aggregate-overzicht in plaats van per-milestone: hoeveel banners er in
 * totaal zijn weggewerkt, hoeveel milestones unlocked, sinds wanneer.
 * Spotify-Wrapped-stijl maar BannerBye-droog.
 */
export function generateStatsCard(
  blockedCount: number,
  unlockedMilestones: number,
  installedAt: number,
): string {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context unavailable');
  }

  // === BACKGROUND ===
  ctx.fillStyle = COLOR_CREAM;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = COLOR_EMBER;
  ctx.fillRect(0, 0, WIDTH, 8);

  // === WORDMARK ===
  ctx.textBaseline = 'top';
  ctx.font = '600 48px "Helvetica Neue", "Arial", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = COLOR_INK;
  ctx.fillText('Banner', 80, 64);
  const bannerWidth = ctx.measureText('Banner').width;
  ctx.fillStyle = COLOR_EMBER;
  ctx.fillText('Bye', 80 + bannerWidth, 64);

  // === LABEL ===
  ctx.textAlign = 'center';
  ctx.font = '500 22px "JetBrains Mono", "Menlo", monospace';
  ctx.fillStyle = COLOR_SMOKE;
  ctx.fillText(t('share_stats_label'), WIDTH / 2, 200);

  // === BLOCKED COUNT (groot) ===
  ctx.font = '700 144px "Helvetica Neue", "Arial", sans-serif';
  ctx.fillStyle = COLOR_EMBER;
  ctx.fillText(blockedCount.toLocaleString('en-US'), WIDTH / 2, 240);

  // === COUNTER LABEL ===
  // De counter-strings ("$COUNT$ cookie banner(s) refused") bevatten zelf al
  // een $COUNT$-placeholder, maar het grote getal erboven staat al los
  // getoond — hier gebruiken we dezelfde sleutel enkel voor het label-deel,
  // dus de placeholder-waarde is gelijk aan het al zichtbare getal.
  ctx.font = '400 28px "Helvetica Neue", "Arial", sans-serif';
  ctx.fillStyle = COLOR_INK;
  const statsCounterText = t(
    blockedCount === 1 ? 'share_counter_singular' : 'share_counter_plural',
    blockedCount.toLocaleString('en-US'),
  );
  ctx.fillText(statsCounterText, WIDTH / 2, 400);

  // === MILESTONES LINE ===
  ctx.font = '500 24px "Helvetica Neue", "Arial", sans-serif';
  ctx.fillStyle = COLOR_SMOKE;
  ctx.fillText(
    t('share_milestones_unlocked', [
      String(unlockedMilestones),
      String(MILESTONES.length),
    ]),
    WIDTH / 2,
    455,
  );

  // === SINCE-LINE ===
  if (installedAt > 0) {
    const since = new Date(installedAt);
    // Locale-aware: gebruikt de UI-taal van de browser/extensie in plaats
    // van hardcoded 'en-US', zodat de maandnaam meevertaalt.
    const uiLocale = chrome.i18n.getUILanguage();
    const sinceText = since.toLocaleDateString(uiLocale, {
      month: 'long',
      year: 'numeric',
    });
    ctx.font = '400 20px "Helvetica Neue", "Arial", sans-serif';
    ctx.fillStyle = COLOR_SMOKE;
    ctx.fillText(t('share_since', sinceText), WIDTH / 2, 495);
  }

  // === TAGLINE ===
  ctx.font = '500 22px "Helvetica Neue", "Arial", sans-serif';
  ctx.fillStyle = COLOR_INK;
  ctx.fillText(t('share_tagline'), WIDTH / 2, 555);

  // === URL ===
  ctx.font = '500 18px "JetBrains Mono", "Menlo", monospace';
  ctx.fillStyle = COLOR_SMOKE;
  ctx.fillText('bannerbye.com', WIDTH / 2, 595);

  return canvas.toDataURL('image/png');
}

/**
 * Download de stats-card via een tijdelijke download-link.
 */
export function downloadStatsCard(
  blockedCount: number,
  unlockedMilestones: number,
  installedAt: number,
): void {
  const dataUrl = generateStatsCard(
    blockedCount,
    unlockedMilestones,
    installedAt,
  );
  const year = new Date().getFullYear();
  triggerDownload(dataUrl, `bannerbye-story-${year}.png`);
}

/** Interne helper: trigger PNG-download via tijdelijke anchor. */
function triggerDownload(dataUrl: string, filename: string): void {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
