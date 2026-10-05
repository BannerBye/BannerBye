# @bannerbye/refuse

`refuse(page)` — the cookie-banner engine of the [BannerBye](https://bannerbye.com) browser extension, as a library for Playwright and Puppeteer, plus an MCP server so agents can read a page instead of a banner.

Same code as the extension's fifth layer: the reject-button finder, the keyword sets in 50+ languages, the structural banner check. Plus the first two layers as a document-start script: a valid IAB TCF v2.2 reject string on `__tcfapi` and in `euconsent-v2`, and Global Privacy Control. No network calls, no telemetry, nothing stored.

## Playwright

```ts
import { chromium } from 'playwright';
import { prepare, refuse } from '@bannerbye/refuse';

const browser = await chromium.launch();
const context = await browser.newContext();
await prepare(context);                       // TCF reject string + GPC before every page

const page = await context.newPage();
await page.goto('https://example.org');
const result = await refuse(page);            // clicks "Reject all", also behind "Manage settings"
// { outcome: 'refused' | 'clean' | 'unresolved', clicks: [...], bannerSignals: [...], ms, ... }
```

## Puppeteer

```ts
const page = await browser.newPage();
await prepare(page);                          // evaluateOnNewDocument + Sec-GPC header
await page.goto('https://example.org');
const result = await refuse(page);
```

## Outcomes

| outcome | meaning |
|---|---|
| `refused` | a reject button was clicked and the banner is gone |
| `clean` | no banner appeared — often because the TCF answer from `prepare()` was enough |
| `unresolved` | a banner is still there and no reject button was found; usually a consent-or-pay wall. BannerBye leaves that choice to a human, and so does this library |

`clicks` lists what was pressed, with the frame and the millisecond offset. `bannerSignals` lists the structural signals of the banner it found (`dialog`, `overlay`, `topZ`, `cmpHint`, `actionPair`).

## MCP server

```json
{ "mcpServers": { "bannerbye": { "command": "npx", "args": ["-y", "@bannerbye/refuse"] } } }
```

Tool `refuse_cookie_banner({ url })` opens the page in headless Chromium, refuses the banner, and returns the outcome plus the visible page text. Needs Playwright's Chromium (`npx playwright install chromium`). Private and loopback hosts are refused.

## Options

```ts
refuse(page, {
  timeoutMs: 8000,     // how long to keep looking
  pollMs: 250,         // scan interval
  settleMs: 600,       // wait after a click before re-checking
  cleanAfterMs: 1500,  // conclude 'clean' if no banner by then
  frames: true,        // also search same-process iframes
});
```

`INPAGE_SOURCE` and `INIT_SOURCE` export the raw scripts if you want to inject them yourself.

## What it will not do

It never clicks accept. If the only buttons are "Accept" and "Pay", it reports `unresolved` and leaves the page as it is. It does not bypass logins, paywalls or bot checks.

## Building from the repository

```
cd packages/refuse
pnpm install
pnpm build     # esbuild bundles the engine from ../../src/lib/autoclick
pnpm test      # node --test against local fixtures
```

MIT — Kreatrix B.V. · [bannerbye.com](https://bannerbye.com) · hello@bannerbye.com
