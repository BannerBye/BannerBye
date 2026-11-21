/**
 * BannerBye-index — maandelijkse meting van hoe moeilijk weigeren is.
 *
 *   cd packages/refuse && pnpm install && pnpm build && npx playwright install chromium
 *   node scripts/index/crawl.mjs [--limit N] [--country NL] > index-YYYY-MM.json
 *
 * Meet per site, als een gewone bezoeker (GEEN TCF-weigerstring, GEEN GPC
 * vooraf — anders verstoppen we de banner die we willen meten):
 *   asks          vraagt de site om toestemming (toestemknop zichtbaar in cookie-context)
 *   rejectFirst   staat er bij het laden al een weigerknop (eerste laag)
 *   settingsOnly  geen weigerknop, wel een instellingenknop (weigeren zit een laag dieper)
 *   cmp           welk consent-platform de site laadt (zichtbare globals)
 *   wall          consent-or-pay: betaalknop + toestemknop, geen gratis weigering
 *   engine        wat de BannerBye-motor ervan maakte: refused | unresolved | clean | error
 *   clicks        aantal klikken van de motor tot de banner weg was (alleen bij refused)
 *
 * Nul telemetrie: dit draait op onze eigen machine, met onze eigen browser.
 * Er komt geen gebruikersdata in.
 */
// playwright staat als devDependency in packages/refuse.
import { chromium } from '../../packages/refuse/node_modules/playwright/index.mjs';
import { readFileSync } from 'node:fs';
import { refuse } from '../../packages/refuse/dist/index.js';
// Dezelfde sleutelwoorden als de extensie (Node 22.6+ leest .ts met type-stripping).
import { isRejectText, containsRejectPhrase, isStepIntoText, hasCookieContext } from '../../src/lib/autoclick/keywords.ts';

// Een gewone desktop-Chrome. Met de standaard "HeadlessChrome"-UA slaan
// sommige uitgevers (DPG Media) hun toestemmingspagina over — dan meet je niets.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const args = process.argv.slice(2);
const limit = Number(args[args.indexOf('--limit') + 1]) || Infinity;
const only = args.includes('--country') ? args[args.indexOf('--country') + 1] : null;
const sites = JSON.parse(readFileSync(new URL('./sites.json', import.meta.url), 'utf8'));
const LOCALE = { NL: 'nl-NL', DE: 'de-DE', FR: 'fr-FR', BE: 'nl-BE' };

const PAY = ['abonnieren', 'abonnement', 'pur-abo', 'werbefrei', 'ohne werbung', 'abonneren', 'zonder advertenties', 'subscribe', 'ad-free', "s'abonner", 'abonnez', 'sans publicité', 'sans pub', 'abbonati'];
const CONSENT = ['zustimmen', 'akzeptieren', 'einverstanden', 'accepteren', 'akkoord', 'accept', 'agree', 'accepter', "j'accepte", 'accett'];

const DETECT = `(() => {
  const w = window, c = [];
  if (w.OneTrust || w.OptanonWrapper) c.push('OneTrust');
  if (w.Cookiebot || w.CookieConsent?.dialog) c.push('Cookiebot');
  if (w.Didomi || w.didomiOnReady) c.push('Didomi');
  if (w.UC_UI || w.__ucCmp || document.getElementById('usercentrics-root') || document.getElementById('usercentrics-cmp-ui')) c.push('Usercentrics');
  if (w._sp_ || w._sp_queue) c.push('Sourcepoint');
  if (w.truste || document.getElementById('truste-consent-track')) c.push('TrustArc');
  if (w.__cmp && !c.length) c.push('Quantcast/InMobi');
  if (w.Osano) c.push('Osano');
  if (w.CookieInformation) c.push('Cookie Information');
  if (w.iubenda || w._iub) c.push('iubenda');
  return { cmps: c, tcf: typeof w.__tcfapi === 'function' };
})()`;

const LABELS = `(() => {
  const out = [];
  const walk = (root) => {
    for (const e of root.querySelectorAll('button, a, [role=button], input[type=button], input[type=submit]')) {
      const r = e.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0)) continue;
      const t = (e.innerText || e.value || e.getAttribute('aria-label') || '').trim();
      if (t && t.length <= 80) out.push(t);
    }
    for (const h of root.querySelectorAll('*')) if (h.shadowRoot) walk(h.shadowRoot);
  };
  walk(document);
  return { labels: out.slice(0, 300), text: (document.body ? document.body.innerText : '').slice(0, 6000) };
})()`;

async function measure(browser, country, host) {
  const ctx = await browser.newContext({ locale: LOCALE[country], userAgent: UA, viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  const row = { country, host, finalHost: null, asks: false, rejectFirst: false, settingsOnly: false, wall: false, cmp: [], tcf: false, engine: 'error', clicks: null, ms: null };
  try {
    await page.goto(`https://${host}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(6000);
    // Uitgevers als DPG Media sturen na het laden door naar een aparte toestemmingspagina.
    await page.waitForLoadState("load", { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const d = await page.evaluate(DETECT).catch(() => ({ cmps: [], tcf: false }));
    row.cmp = d.cmps; row.tcf = d.tcf;
    try { row.finalHost = new URL(page.url()).hostname; } catch {}
    let labels = [], text = '';
    for (const f of page.frames()) {
      const r = await f.evaluate(LABELS).catch(() => null);
      if (r) { labels.push(...r.labels); text += ' ' + r.text; }
    }
    const low = labels.map((l) => l.toLowerCase());
    // Tekst in shadow DOM (DPG Media) zit niet in innerText; de knoplabels wel.
    const ctxOk = hasCookieContext(text + ' ' + labels.join(' '));
    const consent = low.some((l) => CONSENT.some((w) => l.includes(w)));
    const reject = labels.some((l) => isRejectText(l) || containsRejectPhrase(l));
    const pay = low.some((l) => PAY.some((w) => l.includes(w)));
    row.asks = ctxOk && consent;
    row.rejectFirst = row.asks && reject;
    row.settingsOnly = row.asks && !reject && labels.some((l) => isStepIntoText(l));
    row.wall = row.asks && pay && !reject;
    const r = await refuse(page, { timeoutMs: 12000 });
    row.engine = r.outcome;
    row.ms = r.ms;
    if (r.outcome === 'refused') row.clicks = r.clicks.length;
    // De motor kijkt grondiger (attribuut-hints, shadow DOM, frames) dan de
    // labelscan hierboven. Vond hij een banner, dan vroeg de site erom; weigerde
    // hij met één klik, dan zat weigeren op de eerste laag; weigerde hij, dan
    // was het geen muur.
    if (r.outcome === 'refused' || r.outcome === 'unresolved') row.asks = true;
    if (r.outcome === 'refused' && r.clicks.length === 1 && r.clicks[0].action === 'reject') row.rejectFirst = true;
    if (row.rejectFirst || r.outcome === 'refused') { row.wall = false; row.settingsOnly = false; }
  } catch (e) {
    row.error = String(e?.message || e).slice(0, 160);
  } finally {
    await ctx.close().catch(() => {});
  }
  return row;
}

const browser = await chromium.launch();
const rows = [];
for (const [country, list] of Object.entries(sites)) {
  if (country.startsWith('_') || (only && only !== country)) continue;
  for (const host of list.slice(0, limit)) {
    // Harde grens per site: een pagina die een evaluate laat hangen mag de
    // rest van de meting niet blokkeren.
    const row = await Promise.race([
      measure(browser, country, host),
      new Promise((res) => setTimeout(() => res({ country, host, engine: 'error', error: 'timeout 90s' }), 90000)),
    ]);
    rows.push(row);
    process.stderr.write(`${country} ${host} asks=${row.asks} first=${row.rejectFirst} wall=${row.wall} engine=${row.engine}\n`);
  }
}
await browser.close();
process.stdout.write(JSON.stringify({ measuredAt: new Date().toISOString(), method: 'https://bannerbye.com/banner-index#method', rows }, null, 1));
