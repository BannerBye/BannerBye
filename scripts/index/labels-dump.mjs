// Handmatige controle: alle zichtbare knoplabels per site, na 12 s.
import { chromium } from '../../packages/refuse/node_modules/playwright/index.mjs';
import { readFileSync } from 'node:fs';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const LOCALE = { NL: 'nl-NL', DE: 'de-DE', FR: 'fr-FR', BE: 'nl-BE' };
const c = process.argv[2];
const sites = JSON.parse(readFileSync(new URL('./sites.json', import.meta.url), 'utf8'))[c];
const LABELS = `(() => { const out = []; const walk = (r) => { for (const e of r.querySelectorAll('button, a, [role=button], input[type=button], input[type=submit]')) { const x = e.getBoundingClientRect(); if (!(x.width > 0 && x.height > 0)) continue; const t = (e.innerText || e.value || e.getAttribute('aria-label') || '').replace(/\\s+/g,' ').trim(); if (t && t.length <= 60) out.push(t); } for (const h of r.querySelectorAll('*')) if (h.shadowRoot) walk(h.shadowRoot); }; walk(document); return out; })()`;
const RX = /accept|akzept|zustimm|einverstanden|akkoord|accepteer|agree|j.accepte|accetta|weiger|ablehn|refus|reject|rifiut|instell|einstell|param|manage|beheer|option|personali|anpass|abo|subscribe|sans pub|werbe|zonder|without|sans |ohne|senza|ok\b|weiter|continu|doorgaan|cookie|consent|privacy|datenschutz|confidential/i;
const b = await chromium.launch();
for (const h of sites) {
  const ctx = await b.newContext({ locale: LOCALE[c], userAgent: UA, viewport: { width: 1366, height: 900 } });
  const p = await ctx.newPage();
  let out = [];
  try {
    await Promise.race([(async () => {
      await p.goto('https://' + h + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await p.waitForTimeout(9000); await p.waitForLoadState('load', { timeout: 8000 }).catch(() => {}); await p.waitForTimeout(3000);
      for (const f of p.frames()) { const l = await f.evaluate(LABELS).catch(() => []); out.push(...l); }
    })(), new Promise((r) => setTimeout(r, 60000))]);
  } catch (e) { out = ['ERR ' + String(e.message).slice(0, 60)]; }
  const hit = [...new Set(out.filter((t) => RX.test(t)))].slice(0, 14);
  console.log(c + ' ' + h + ' | ' + hit.join(' / '));
  await ctx.close().catch(() => {});
}
await b.close();
