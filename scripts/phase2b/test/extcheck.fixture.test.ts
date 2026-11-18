/**
 * Bewaakt de extensiecheck zelf: laadt de echt gebouwde extensie
 * (BB_EXTENSION_PATH = .output/chrome-mv3) tegen drie lokale pagina's.
 * Zonder BB_EXTENSION_PATH wordt deze test overgeslagen; in CI draait hij
 * altijd (job "pipeline" in ci.yml). Faalt hij, dan bewijst de extensiecheck
 * in de echte pijplijn niets meer — bijvoorbeeld omdat headless Chromium
 * geen extensies meer laadt.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { checkWithExtension, extensionPath } from '../extcheck.ts';
import { buildDetectScript } from '../detect.ts';
import { bannerStructureSignals } from '../../../src/lib/autoclick/banner-structure.ts';

const DETECT = buildDetectScript(bannerStructureSignals.toString());
const FIXTURES = join(import.meta.dirname, 'fixtures');
const PROFILE = {
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  viewport: { width: 1280, height: 900 },
  locale: 'de-DE',
  isMobile: false,
  hasTouch: false,
  deviceScaleFactor: 1,
};

test('extensiecheck: weigert, ziet een blijvende banner en ziet een lus', { skip: !extensionPath() && 'BB_EXTENSION_PATH niet gezet', timeout: 120000 }, async () => {
  const server = createServer(async (req, res) => {
    try {
      const name = (req.url ?? '/').replace(/^\//, '').replace(/[^a-z-]/g, '');
      const body = await readFile(join(FIXTURES, `${name}.html`));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const ok = await checkWithExtension(`${base}/refusable`, PROFILE, DETECT, { waitMs: 1000 });
    assert.equal(ok.ran, true, ok.note);
    assert.equal(ok.bannerStill, false, 'BannerBye had "Nur notwendige Cookies akzeptieren" moeten klikken');

    const stuck = await checkWithExtension(`${base}/unknown-button`, PROFILE, DETECT, { waitMs: 1000 });
    assert.equal(stuck.ran, true, stuck.note);
    assert.equal(stuck.bannerStill, true, 'onbekende knop: banner hoort te blijven staan');

    const loop = await checkWithExtension(`${base}/reload-loop`, PROFILE, DETECT, { waitMs: 1000 });
    assert.equal(loop.ran, true, loop.note);
    assert.equal(loop.loop, true, `lus niet gezien (${loop.navigations} navigaties)`);
  } finally {
    server.close();
  }
});
