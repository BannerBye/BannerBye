# BannerBye — architecture

Hoog-niveau overzicht van hoe het ding in elkaar zit. Voor implementatie-details: lees de code, die heeft commentaar.

## Doel

Cookie-banners voorkomen voordat ze renderen door de site preventief te vertellen dat je niet consent geeft.

Drie signaal-lagen, in volgorde van zekerheid, plus een fallback:

1. **GPC** — `Sec-GPC: 1` HTTP-header + `navigator.globalPrivacyControl = true`. Wettelijk bindend in groeiende lijst US-staten.
2. **IAB TCF v2.2** — TC-string die "no" zegt op alle purposes/vendors. Dekt de meeste EU-CMP-banners.
3. **CMP-specifiek** — voor de top 5 (OneTrust, Cookiebot, Usercentrics, TrustArc, Didomi): pre-set cookies/storage zodat hun banner-logica ziet "user heeft al geantwoord".
4. **Auto-click fallback** — voor custom-built consent UI's: lees zichtbare button labels, klik "reject all" / "necessary only". Keywords-set wordt dagelijks ververst via `bannerbye.com/rules.json` — geen extension release nodig voor nieuwe varianten.

Als alle vier de lagen falen op een site:
- De popup heeft een **"Report broken site"** knop. Eén tap → POST naar `bannerbye.com/api/report` met hostname + extension version + user-agent + optionele textarea-tekst. Mail naar `hello@bannerbye.com`. Wij analyseren handmatig en pushen een fix in `rules.json` of een nieuwe extension release.
- *Niet* CSS-hiden — dat is bewust geschrapt 2026-04-21. Conflict met "BannerBye refuses"-positionering: hiding ≠ refusing.

## Folder-layout

```
src/
├── entrypoints/
│   ├── background.ts          MV3 service worker — orchestreert dynamic content-script registratie, counter, badge
│   ├── bridge.content.ts      ISOLATED world relay — luistert naar document events vanuit MAIN-world scripts
│   ├── gpc.content.ts         GPC-signal: navigator.globalPrivacyControl = true (MAIN world)
│   ├── tcf.content.ts         IAB TCF v2.2 __tcfapi stub die "no consent" rapporteert
│   ├── cmp.content.ts         CMP-detect + pre-set cookies/storage voor top 5 CMPs
│   ├── autoclick.content.ts   Three-pass auto-click engine (strict → ambiguous → step-into)
│   ├── popup/                 React popup: on/off + per-site pause + milestones dashboard + Report broken site modal
│   └── onboarding/            3-screen welkomst-flow bij eerste install
├── lib/
│   ├── types.ts               Gedeelde types (Settings, LocalStats, etc.)
│   ├── storage.ts             chrome.storage.sync + .local wrappers
│   ├── host.ts                Hostname-helpers
│   ├── tcf/                   bitwriter, tcstring, tcdata, index — TC-string generator/parser
│   ├── cmp/                   Per-CMP handlers (onetrust, cookiebot, usercentrics, trustarc, didomi)
│   ├── autoclick/             keywords, finder (Shadow-DOM walking), orchestrator (3 passes)
│   ├── rules/                 Remote rule-fetcher (chrome.alarms daily)
│   ├── milestones/            7-milestone definitie + computeNewUnlocks logic
│   └── share-card/            Canvas-based PNG generator voor milestone + year-end recap
public/
├── icon.svg                   Master logo
├── icon/                      Gegenereerde PNG-iconen (16/32/48/96/128)
└── state/                     MAIN-world flag-setter scripts (flag-active, flag-disabled) voor real-toggle
rules/
└── gpc-headers.json           declarativeNetRequest rule voor Sec-GPC header
scripts/
└── tcf-sample.ts              Validatie-script voor TCF-string generator
```

## Manifest-permissions

| Permission | Waarom |
|---|---|
| `storage` | Settings + stats opslaan |
| `tabs` / `activeTab` | Hostname van actieve tab uitlezen voor popup |
| `declarativeNetRequest` | GPC-header naar requests toevoegen |
| `scripting` | Dynamic content-script registration voor flag-setters + auto-click fallback |
| `alarms` | Daily fetch van remote rules.json |
| `host_permissions: <all_urls>` | We werken op het hele web — anders is BannerBye nutteloos |

## Storage-model

**`chrome.storage.sync` (synced cross-device, max 100 KB):**
- `enabled`: globale on/off
- `pausedSites`: list van hostnames waar gebruiker pauzeerde
- `onboardingCompleted`: voor first-run UX

**`chrome.storage.local` (per device, geen sync):**
- `blocked`: counter (incrementeert op elke gedetecteerde block via GPC/TCF/CMP/auto-click)
- `installedAt`: timestamp
- `unlockedMilestones[]`: lijst van milestone IDs die de gebruiker heeft gehaald
- `pendingCelebrations[]`: nieuwe milestones die nog niet zijn weergegeven in de popup
- `remoteRules`: gecachete rules.json content
- `remoteRulesFetchedAt`: timestamp laatste fetch

Per-device counter is bewuste keus: anders telt elke device dubbel als je op twee laptops dezelfde site bezoekt.

## Real global toggle (sinds v0.2.0)

Pre-v0.2.0 stopte "BannerBye uit" alleen de GPC-header. Inhalen werd alsnog gedaan door TCF/CMP/auto-click — een fout. Sinds v0.2.0:

- Alle TCF/CMP/GPC/auto-click content-scripts hebben een **inert match-pattern** in hun manifest-registratie (`https://_bb_runtime_only_.invalid/*` voor Chrome) zodat ze niet automatisch op pages worden geïnjecteerd.
- `background.ts` heeft een `syncFlagSetterScripts(settings)` functie die bij elke settings-change `chrome.scripting.registerContentScripts` (en `unregisterContentScripts`) gebruikt om de juiste flag-setter (`flag-active.js` of `flag-disabled.js`) op `document_start` te registreren met `excludeMatches` op paused hosts.
- Elk content-script start zijn `main()` met `readActiveState()` die checkt of de flag-setter een actief signaal heeft achtergelaten op `window.__bannerbyeState`.
- `persistAcrossSessions: false` op de dynamic registration voor Chrome-stabiliteit.

Voor MV3 cross-world communicatie van block-events: zie *Counter event bridge* hieronder.

## Counter event bridge (sinds v0.2.0)

Block-detectie zit in MAIN-world content-scripts (TCF/CMP). De counter zit in ISOLATED-world (`background.ts` via `chrome.runtime.sendMessage`). `window.dispatchEvent` werkt NIET cross-world in Chrome MV3 — elk world heeft eigen window event listeners.

Oplossing:
1. TCF/CMP content-scripts dispatchen `document.dispatchEvent(new CustomEvent('bb:tcf-blocked'))` of `'bb:cmp-blocked'` zodra een block plaatsvindt.
2. `bridge.content.ts` (ISOLATED world, document_start) luistert via `document.addEventListener` en relayed naar background met `chrome.runtime.sendMessage({ type: 'bb:banner-blocked' })`.
3. `background.handleBannerBlocked(tabId)` increments counter + flasht badge + checkt nieuwe milestones via `computeNewUnlocks`.

`document` is shared tussen worlds; `window` niet. Dit is de canonical pattern voor MV3 cross-world events.

## Milestones & celebration UI

Bij elke counter-increment checkt `background.ts` of een nieuwe milestone wordt gehaald (1 / 10 / 100 / 1000 / 10000 banners, plus 30 / 365 dagen actief). Zo ja:

- ID wordt toegevoegd aan `unlockedMilestones[]` én `pendingCelebrations[]`
- Badge in toolbar flasht "🎉" voor 3 sec
- Bij volgende popup-open verschijnt celebration-card met share-button (`share-card/index.ts` genereert 1200×630 PNG via Canvas API) en dismiss-button

Geen streak-pressure, geen daily push-notifications, geen Pro-unlock-bait. Bewust geen gamification — zie anti-pattern checklist in skill `references/`.

## Levenscyclus van een page-load

1. Browser start request naar `example.com`
2. **DNR-ruleset** voegt `Sec-GPC: 1` toe aan request-headers
3. Server reageert. HTML wordt geparsed.
4. **`flag-active.js`** (MAIN world, dynamic-registered) runt eerst en zet `window.__bannerbyeState`
5. **`gpc.content.ts`** runt en zet `navigator.globalPrivacyControl = true` op de Navigator-prototype
6. **`tcf.content.ts`** registreert `__tcfapi` callback met "no consent"-string, dispatcht `bb:tcf-blocked` bij eerste call
7. **`cmp.content.ts`** detecteert welke CMP draait, pre-set hun cookies/storage, dispatcht `bb:cmp-blocked` bij successful handler
8. **`bridge.content.ts`** (ISOLATED) relayed events naar background
9. Page-scripts laden, zien de signalen, slaan banner over
10. *Fallback* — als banner toch verschijnt: **`autoclick.content.ts`** detecteert de "reject"-knop (Shadow-DOM walking, banner-context-aware) en klikt 'm

## Multi-browser strategie

- **Chrome / Edge / Brave / Arc:** Manifest V3 native. Eén build dekt alle Chromium-browsers.
- **Firefox:** MV3 sinds Firefox 109+. Apart manifest-veld voor extension-ID. WXT compileert apart.
- **Safari (macOS + iOS):** Web Extensions API (gebaseerd op WebExtensions, MV3-compatible sinds Safari 17). Vereist Xcode-wrapper rond de WebExtension om als macOS/iOS-app te bundelen voor App Store. WXT genereert dat Xcode-project automatisch.

Match-pattern truc voor dynamic registration: omdat we manifest-static registratie willen voorkomen (anders draaien scripts vóór flag-setters), gebruiken we voor Chrome een inert match-pattern (`https://_bb_runtime_only_.invalid/*`). Voor Firefox/Safari geldt `<all_urls>` met een runtime-check in elk script. Compile-time switch via `import.meta.env.BROWSER`.

## Wat NIET in de codebase hoort

- **Passive telemetry / analytics** — bewuste keus, ondermijnt "zero passive tracking" claim. Eén uitzondering: het `/api/report`-endpoint, dat alléén bij expliciete user-tap fires.
- **Account-systeem** — geen login, geen sync-server, alles via browser-native sync
- **CSS-hide fallback** — bewust geschrapt 2026-04-21, conflicteert met "BannerBye refuses"-positionering
- **Crash-reporting / Sentry / Datadog** — als het breekt, gebruiker tikt "Report broken site" in de popup
- **Streak-pressure UI** — geen "Don't break your 3-day streak!" — zie anti-pattern checklist

## Verder lezen

- README — what + why + install
- SETUP.md — local development setup
- LICENSE — MIT
- Skill `bannerbye` in `07. Skills/bannerbye/` (privé) — productbeslissingen, brand voice, infrastructure
