# Phase 2B — analyzer

Headless analyse van gemelde "broken sites" + automatische keyword-voorstellen.

## Wat het doet

1. Leest uit Upstash Redis welke hosts nog niet onderzochte meldingen hebben (Phase 2A).
2. Bezoekt elke host met headless Chromium (Playwright).
3. Detecteert: TCF/CMP-globals, of er een zichtbare consent-banner is, en de
   teksten van klikbare knoppen in die banner. Sinds v0.4.4 ook een zwak
   vormsignaal (fixed/sticky container + meerdere knoppen) als vangnet voor
   banners zonder één Latijns-schrift cookie/consent-woord — anders wordt zo'n
   banner al vóór classificatie onzichtbaar (zie detect.ts).
4. Classificeert (hergebruikt de échte extensie-keyword-logica uit
   `src/lib/autoclick/keywords.ts`):
   - `custom_unmatched` → stelt een reject-keyword voor
   - `tcf_or_cmp` / `accept_only` / `unknown` → flag voor handmatige review
   - `no_banner` → niet reproduceerbaar / al opgelost
   - `possible_language_gap` (v0.4.4) → geen enkele knop matcht een bekend
     keyword of een Latijns-schrift indicatorwoord in classify.ts — vermoedelijk
     een taal die nog niet gedekt is (het coffeeisland.gr-patroon, sep 2026).
     `analyze.ts` vraagt in dat geval Claude (`proposeLanguageGapKeywords` in
     `claude.ts`) de taal te herkennen, EERST te beoordelen of het überhaupt
     een consent-banner is, en zo ja kandidaat-keywords voor te stellen
     (inclusief een accentloze variant waar het schrift dat vereist — zie de
     Griekse les in `src/lib/autoclick/keywords.ts`). Deze voorstellen gaan
     ALTIJD nog door dezelfde onafhankelijke `judgeKeyword()`-stap als elk
     ander voorstel — de generator beoordeelt nooit zijn eigen werk.
5. Markeert meldingen als onderzocht + bewaart per-host analyse in Redis.
6. Merget voorstellen in `repo/rules.json` en (via de workflow) opent een **draft-PR**.

Draait in `.github/workflows/phase2b-analyze.yml` (dagelijks + handmatig).

## Taalgat-generator (v0.4.4)

Structurele opvolging van de Griekse coffeeisland.gr-fix (sep 2026, zie
`SKILL.md` §11/§13 in de Cowork-skill): in plaats van te wachten tot een
gebruiker een kapotte site meldt en iemand handmatig de taal uitzoekt, doet
deze pijplijn dat nu zelf bij elke host die op `possible_language_gap`
classificeert. Twee losse Claude-calls, bewust gescheiden:

1. `proposeLanguageGapKeywords()` (nieuw, `claude.ts`) — genereert kandidaten:
   welke knop betekent "weiger alles", welke opent alleen een instellingen-
   paneel, en (cruciaal) is dit überhaupt een consent-banner.
2. `judgeKeyword()` (bestaand) — onafhankelijke tweede beoordeling per
   kandidaat, exact dezelfde strenge lat als voor Latijns-schrift-voorstellen.
   Alleen approve+high mag automatisch naar `rules.json`.

Zo blijft de garantie overeind dat er nooit een ongecontroleerd voorstel
live gaat, terwijl de taaldekking nu ook zonder gebruikersmelding kan groeien.

## Lokaal draaien

```
cd scripts/phase2b
npm install
npx playwright install chromium
KV_REST_API_URL=... KV_REST_API_TOKEN=... node --experimental-strip-types analyze.ts
```

Env-opties: `MAX_HOSTS` (25), `NAV_TIMEOUT_MS` (20000), `WAIT_MS` (3500).

## Secrets (GitHub → Settings → Secrets → Actions)

- `KV_REST_API_URL`, `KV_REST_API_TOKEN` — zelfde Upstash-waarden als in Vercel
  (project bannerbye → Storage → bannerbye-reports → `.env.local` → Show secret).

De workflow gebruikt verder de ingebouwde `GITHUB_TOKEN` voor de draft-PR.

## Publiceren

Zie [`PUBLISH.md`](./PUBLISH.md) — na merge sync je `repo/rules.json` naar de
deploy-folder en draai je `vercel --prod`.

## Veiligheid

- Nooit auto-merge: alleen draft-PR's.
- Conservatief: een keyword wordt alleen voorgesteld bij cookie-context +
  weiger-indicator én als de extensie het nu nog niet matcht.
- Taalgat-voorstellen (v0.4.4) doorlopen dezelfde `judgeKeyword()`-poort als
  elk ander voorstel — een generator-call beoordeelt nooit zijn eigen werk.
- Geen PII in PR's of analyse-records (alleen hostname + knop-teksten + categorie).
