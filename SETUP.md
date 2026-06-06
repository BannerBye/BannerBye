# BannerBye — local setup

Eerste keer draaien op een fresh machine.

## Vereisten

- **Node.js 22.x** (`brew install node`) — exact deze versie, want Vercel functions in de bannerbye.com deploy gebruiken 22.x en lokale parity voorkomt verrassingen
- **pnpm 9+** (`npm install -g pnpm`)
- **Playwright** (al geïnstalleerd via OG-image-werk; anders `pnpm add -D playwright && pnpm exec playwright install chromium`)
- Voor Safari-builds: **macOS + Xcode 15+** (alleen relevant als je `pnpm build:safari` draait)

## Installeren

```bash
cd /path/to/bannerbye
pnpm install
```

`postinstall` runt automatisch `wxt prepare` — dat genereert de TypeScript-types voor browser-APIs in `.wxt/`.

## Iconen genereren (eenmalig + bij logo-wijziging)

```bash
pnpm exec node scripts/generate-icons.mjs
```

Dit zet PNG-iconen in `public/icon/{16,32,48,96,128}.png`. WXT pikt die automatisch op tijdens build.

## Dev-mode (Chrome)

```bash
pnpm dev
```

WXT opent een Chrome-instance met de extensie geladen. Hot-reload op alle bestandswijzigingen.

## Dev-mode (Firefox)

```bash
pnpm dev:firefox
```

## Production-builds

```bash
pnpm build           # Chrome (.output/chrome-mv3/)
pnpm build:firefox   # Firefox (.output/firefox-mv3/)
pnpm build:safari    # Safari (.output/safari-mv3/) — vereist macOS + Xcode

pnpm build:all       # alle drie achter elkaar
```

## Geüploade .zip's voor de stores

```bash
pnpm zip             # Chrome Web Store-ready zip
pnpm zip:firefox     # Firefox AMO-ready zip
```

## Testen of GPC werkt

1. `pnpm dev`
2. Open `https://global-privacy-control.glitch.me/` in de extensie-Chrome
3. Site moet "Sec-GPC: 1" detecteren en `navigator.globalPrivacyControl: true` rapporteren

Andere goede testsites:
- `https://www.washingtonpost.com` — respecteert GPC, je ziet aangepast cookie-gedrag
- `https://www.nytimes.com` — idem
- DevTools → Network tab → controleer of requests `Sec-GPC: 1` header sturen

## Troubleshooting

**`wxt: command not found`** → `pnpm install` opnieuw, of run via `pnpm exec wxt`.

**Firefox laadt extensie niet** → Firefox vereist een geldige extension ID. We hebben `bannerbye@bannerbye.com` ingesteld in `wxt.config.ts`. Check dat manifest klopt na build.

**Safari build faalt** → Xcode moet geïnstalleerd zijn (niet alleen Command Line Tools). `xcode-select --install` is niet genoeg; je hebt de full Xcode app nodig.

**`declarativeNetRequest is not defined`** → Browser ondersteunt geen MV3 of de permissions zijn niet correct. Check dat `permissions` in manifest `declarativeNetRequest` bevat.
