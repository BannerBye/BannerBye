# BannerBye

**Cookie banners, killed. Before they load.**

Set your privacy once. BannerBye handles every cookie banner before it reaches you — automatically, on every site.

[bannerbye.com](https://bannerbye.com) · [Install free](https://bannerbye.com#install)

---

## What this is

BannerBye is a browser extension that speaks the consent language your browser was born with. When you visit a site, it tells the site you've already said no — using GPC (Global Privacy Control), IAB TCF v2.2, and CMP-specific signals.

The banner doesn't appear. Not because we hid it. Because the site knows better than to ask.

## Why this repo exists

**1. Trust is earned by the code.** Every signal we send is visible here. If you don't believe our claim that we don't track you, audit it yourself.

**2. Rules change when the web changes.** Consent banners evolve. New CMPs appear. The ruleset is a living document — and it's better if the people it affects can read and improve it.

**3. We're not in the banner business.** BannerBye is a refusal, not a product. Open source is the only honest form for something that exists to protect you *from* the web's defaults.

## How it works

Three signal layers, in order of precedence, plus a fallback.

**GPC (Global Privacy Control)** — the W3C signal that tells sites "this user does not consent to the sale or sharing of personal data." Machine-readable. Legally binding in California, Colorado, Connecticut, and a growing list of jurisdictions.

**IAB TCF v2.2** — the industry's own consent framework. The extension generates a TC string that says *no* to every purpose and vendor, signed and timestamped like any legitimate consent record.

**CMP signatures** — for sites using OneTrust, TrustArc, Cookiebot, Didomi, Usercentrics, and the other major CMPs, the extension speaks their specific API dialect so the banner logic sees "this user already answered" and stays asleep.

**Auto-click fallback** — for sites with custom-built consent UIs (most Dutch e-commerce, news, and forum sites), the extension reads the visible button labels and clicks the "Reject all" or "Necessary only" option for you. The list of recognised buttons updates daily via `bannerbye.com/rules.json` — no extension release needed for new variants.

The banner's decision tree never reaches the "show" branch.

## Status

**Live.** v0.2.0 is shipping in production:

- **Chrome Web Store** — installable now
- **Mozilla AMO** — installable now
- **Mac App Store** — Safari extension, €1.99
- **iOS App Store** — Safari extension for iPhone and iPad, €1.99
- **Microsoft Edge** — works via the Chrome version; standalone Edge listing pending
- **Other Chromium browsers** (Brave, Arc, Vivaldi) — works via the Chrome version

Install links: [bannerbye.com](https://bannerbye.com)

## What we collect

Almost nothing.

**Default behaviour** — zero telemetry. No accounts, no analytics, no usage tracking. Your settings and counters live in your browser's local storage.

**One exception** — the "Report broken site" button in the popup. When you tap it, the extension sends the hostname of the current tab (e.g. `zalando.nl`, no paths, no query strings), the extension version, your user agent, your IP address, and any optional message you type, to our private inbox via a serverless function on `bannerbye.com/api/report`. We use these reports to fix sites where BannerBye stops working. Nothing more.

Full privacy policy: [bannerbye.com/privacy](https://bannerbye.com/privacy).

## Repo layout

```
bannerbye/
├── src/
│   ├── entrypoints/         # Background + content scripts + popup + onboarding
│   ├── lib/                 # TCF, autoclick engine, milestones, share-card, storage, rules
│   └── public/state/        # MAIN-world flag-setter scripts (real-toggle)
├── rules/                   # declarativeNetRequest rule-sets
├── scripts/                 # Build + TCF-sample validator
├── wxt.config.ts            # WXT 0.19 + Manifest V3 config
├── package.json
├── LICENSE                  # MIT
└── README.md
```

Built with [WXT](https://wxt.dev) 0.19 + Vite 6 + pnpm + TypeScript. Manifest V3 across Chrome, Firefox, and Safari (via WXT's `safari` target + Xcode wrapper).

## Build

Requires Node 22.x + pnpm 9.x.

```bash
pnpm install
pnpm dev               # Chrome dev build, hot reload
pnpm dev:firefox       # Firefox dev build
pnpm build             # production build → .output/chrome-mv3/
pnpm zip               # build + zip for store upload
pnpm tcf:sample        # validate TCF string generation
```

## Contributing

Found a CMP we don't handle yet? Found a site where the banner still shows? **The fastest path is the in-extension "Report broken site" button** — it goes straight to our inbox, with the URL pre-filled.

For code contributions: open an issue first to discuss approach. Rules in `rules/` are JSON — no build step, no gatekeeping, easy first PRs.

## Principles

- **Legal, not loud.** We send the signals that are written into law. No clever hacks that break next week.
- **Open by default.** Every rule, every line of code, public here. If you don't trust it, fork it.
- **Zero passive tracking.** The extension never phones home on its own. The only exception is the "Report broken site" button, which is an explicit user action — see *What we collect* above.
- **One preference, every browser.** Chrome, Firefox, Safari live now. Edge planned.

## License

[MIT](./LICENSE). Use it, fork it, ship it. Just don't pretend you wrote it.

---

Made in Brainport.
