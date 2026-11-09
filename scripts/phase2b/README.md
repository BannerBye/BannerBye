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

## Codefixes op /fixed (`publish-fixed.ts`)

De pijplijn hierboven dekt alleen keyword-fixes. Een site die met een
codewijziging is gerepareerd — een CMP-handler, een iframe-guard, een
PDF-uitzondering — raakt die pijplijn nooit en belandde daarom nooit in de
publieke changelog op https://bannerbye.com/fixed. Dat werd elke release-golf
met de hand rechtgezet, en drie keer op rij vergeten.

Werkwijze nu: zet de site in **`fixed-sites.json`** in de repo-root, in
hetzelfde commit als de versiebump. `.github/workflows/publish-fixed.yml`
schrijft hem naar Redis zodra de opgegeven datum bereikt is (push op main,
wekelijkse cron, of handmatig met een dry-run-knop).

Drie vangrails in `publish-fixed.ts`:

1. **Puur additief** — een hostnaam die al in `bb:fixed` staat wordt
   overgeslagen, nooit overschreven. Keyword-fixes uit de pijplijn blijven met
   rust, ook als dezelfde host per ongeluk in het manifest terechtkomt.
2. **Geen toekomst** — een regel met een datum die nog niet bereikt is blijft
   liggen tot de cron hem oppakt. Zo kun je het manifest invullen bij de bump
   zonder iets te beloven wat nog in store-review ligt.
3. **Harde validatie** — scheve hostnaam, onleesbare datum of dubbele regel
   laat de run falen in plaats van rommel de publieke changelog in te schrijven.

Lokaal controleren zonder te schrijven:

```
cd scripts/phase2b
KV_REST_API_URL=... KV_REST_API_TOKEN=... \
  node --experimental-strip-types publish-fixed.ts --dry-run
```

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

## Pijplijn v2 (0.4.17, 9 nov 2026)

Aanleiding: portal.newdaycards.com — root 404, banner alleen op `/aqua/login`,
melder op Android; v1 bezocht de root met een desktop en mailde "vals positief".

Wat er veranderde:

- **Melding v2** (extensie): pad (opgeschoond), taal, viewport, DOM-snapshot
  van de banner-knoppen (`src/lib/report-snapshot.ts`) en de trace gaan mee.
  `api/report.ts` (landing) valideert en begrenst alles opnieuw.
- **Profielen** (`analyze.ts`): eerst zoals de melder (mobiel/desktop, pad,
  taal), dan desktop op `/`. Herhaalpogingen met andere profielen en langer
  wachten.
- **Snapshot als bewijs** (`evidence.ts`): ziet headless niets, dan draait
  dezelfde classificatie op de knoplabels die de melder zag.
- **Host-scoped auto-apply**: Claude approve/high → `autoclick.hostRules[host]`
  direct op main (`apply-host-rules.ts`, daarna `publish-autofixed.ts` voor
  /fixed + tickets). Bewuste uitzondering op security-fix #1; blast radius één
  host. Globale keywords blijven via de review-PR; een host-keyword op ≥ 2
  hosts wordt daar automatisch voorgedragen (`hostRuleKeywordsSeenOn`).
- **Wachtrij** (`bb:retry`): niets gezien → opnieuw na 6 u, max 3 pogingen
  (schedule-run met `RETRY_MODE=1`), daarna "jouw blik nodig".
- **Mail**: per host wat de melder zag, wat wij probeerden, uitkomst, to-do,
  plus twee zinnen duiding van Claude. Onderwerp zegt of Robin iets moet doen.

Offline test zonder browser/Redis: `node --experimental-strip-types test-evidence.ts`.
