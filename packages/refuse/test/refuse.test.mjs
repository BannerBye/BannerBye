// Draait tegen twee lokale fixtures: een banner met de weigerknop achter
// een instellingen-stap, en een pagina zonder banner. Vereist Playwright
// met Chromium (BB_CHROME mag een eigen binary aanwijzen).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { prepare, refuse } from '../dist/index.js';

const BANNER = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Fixture</title>
<style>#cb{position:fixed;left:0;right:0;bottom:0;background:#fff;border-top:1px solid #ccc;padding:20px;font:16px sans-serif;z-index:1000}
#panel{display:none}button{font-size:16px;padding:10px 16px;margin:4px}</style></head><body>
<h1>Article</h1><p>Body text.</p>
<div id="cb" role="dialog"><p>We and our partners use cookies to personalise content and ads. You can change your choices at any time.</p>
<div id="first"><button id="accept">Accept all</button><button id="manage">Manage settings</button></div>
<div id="panel"><button id="save">Save and accept</button><button id="reject">Reject all</button></div></div>
<script>
document.getElementById('manage').onclick=()=>{document.getElementById('first').style.display='none';document.getElementById('panel').style.display='block';};
document.getElementById('reject').onclick=()=>{document.getElementById('cb').remove();document.title='REFUSED';};
document.getElementById('accept').onclick=()=>{document.title='ACCEPTED';};
document.getElementById('save').onclick=()=>{document.title='ACCEPTED';};
</script></body></html>`;

const CLEAN = `<!doctype html><html><head><title>Clean</title></head><body><h1>No banner here</h1><p>Just text.</p>
<script>window.__tcfapi('getTCData',2,(d,ok)=>{document.title = ok && d.tcString ? 'TCF:'+d.tcString.slice(0,4) : 'NOTCF';});</script></body></html>`;

function serve() {
  return new Promise((resolve) => {
    const srv = createServer((req, res) => {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(req.url.startsWith('/clean') ? CLEAN : BANNER);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

const launch = () => chromium.launch({ headless: true, executablePath: process.env.BB_CHROME || undefined, args: ['--no-sandbox'] });

test('refuses a banner whose reject button sits behind a settings step', async () => {
  const srv = await serve();
  const port = srv.address().port;
  const browser = await launch();
  try {
    const context = await browser.newContext();
    await prepare(context);
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${port}/banner`);
    const r = await refuse(page, { timeoutMs: 6000 });
    assert.equal(r.outcome, 'refused');
    assert.deepEqual(r.clicks.map((c) => c.action), ['stepInto', 'reject']);
    assert.equal(await page.title(), 'REFUSED');
    assert.ok(r.bannerSignals.includes('dialog'));
    assert.equal(r.tcfPrepared, true);
  } finally {
    await browser.close();
    srv.close();
  }
});

test('reports clean and answers __tcfapi on a page without a banner', async () => {
  const srv = await serve();
  const port = srv.address().port;
  const browser = await launch();
  try {
    const context = await browser.newContext();
    await prepare(context);
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${port}/clean`);
    const r = await refuse(page, { timeoutMs: 3000 });
    assert.equal(r.outcome, 'clean');
    assert.equal(r.clicks.length, 0);
    assert.match(await page.title(), /^TCF:/);
    assert.equal(await page.evaluate(() => navigator.globalPrivacyControl), true);
  } finally {
    await browser.close();
    srv.close();
  }
});
