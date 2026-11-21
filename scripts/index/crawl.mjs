/**
 * BannerBye-index — maandelijkse meting van hoe moeilijk weigeren is.
 *
 *   cd packages/refuse && pnpm install && pnpm build && npx playwright install chromium
 *   node scripts/index/crawl.mjs [--limit N] [--country NL] > index-YYYY-MM.json
 *
 * Meet per site, als een gewone bezoeker (GEEN TCF-weigerstring, GEEN GPC
 * vooraf — anders verstoppen we de banner die we willen meten):
 *   banner        is er een cookiebanner te zien (structureel herkend)
 *   cmp           welk consent-platform de site laadt (zichtbare globals)
 *   wall          consent-or-pay: betaalknop + toestemknop, geen gratis weigering
 *   firstLayer    zit "weigeren" op de eerste laag (eerste klik = weigeren)
 *   clicks        aantal klikken tot de banner weg is (alleen bij outcome 'refused')
 *   outcome       refused | unresolved | clean | error
 *
 * Nul telemetrie: dit draait op onze eigen machine, met onze eigen browser.
 * Er komt geen gebruikersdata in.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { refuse } from '../../packages/refuse/dist/index.js';

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

const WALL = `((PAY, CONSENT) => {
  const els = [...document.querySelectorAll('button, a, [role=button]')].filter(e => {
    const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0;
  });
  let pay = false, ok = false;
  for (const e of els) {
    const t = (e.innerText || '').toLowerCase().trim();
    if (!t || t.length > 80) continue;
    if (PAY.some(w => t.includes(w))) pay = true;
    else if (CONSENT.some(w => t.includes(w))) ok = true;
  }
  return pay && ok;
})`;

async function measure(browser, country, host) {
  const ctx = await browser.newContext({ locale: LOCALE[country], viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  const row = { country, host, outcome: 'error', banner: false, cmp: [], tcf: false, wall: false, firstLayer: null, clicks: null, ms: null };
  try {
    await page.goto(`https://${host}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(4000);
    const d = await page.evaluate(DETECT).catch(() => ({ cmps: [], tcf: false }));
    row.cmp = d.cmps; row.tcf = d.tcf;
    for (const f of page.frames()) {
      if (await f.evaluate(`(${WALL})(${JSON.stringify(PAY)}, ${JSON.stringify(CONSENT)})`).catch(() => false)) { row.wall = true; break; }
    }
    const r = await refuse(page, { timeoutMs: 12000 });
    row.outcome = r.outcome;
    row.banner = r.outcome !== 'clean';
    row.ms = r.ms;
    if (r.clicks.length) row.firstLayer = r.clicks[0].action === 'reject';
    if (r.outcome === 'refused') row.clicks = r.clicks.length;
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
    const row = await measure(browser, country, host);
    rows.push(row);
    process.stderr.write(`${country} ${host} ${row.outcome}${row.wall ? ' wall' : ''}\n`);
  }
}
await browser.close();
process.stdout.write(JSON.stringify({ measuredAt: new Date().toISOString(), method: 'https://bannerbye.com/banner-index#method', rows }, null, 1));
