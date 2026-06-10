# Phase 2B — analyzer

Headless analyse van gemelde "broken sites" + automatische keyword-voorstellen.

## Wat het doet

1. Leest uit Upstash Redis welke hosts nog niet onderzochte meldingen hebben (Phase 2A).
2. Bezoekt elke host met headless Chromium (Playwright).
3. Detecteert: TCF/CMP-globals, of er een zichtbare consent-banner is, en de
   teksten van klikbare knoppen in die banner.
4. Classificeert (hergebruikt de échte extensie-keyword-logica uit
   `src/lib/autoclick/keywords.ts`):
   - `custom_unmatched` → stelt een reject-keyword voor
   - `tcf_or_cmp` / `accept_only` / `unknown` → flag voor handmatige review
   - `no_banner` → niet reproduceerbaar / al opgelost
5. Markeert meldingen als onderzocht + bewaart per-host analyse in Redis.
6. Merget voorstellen in `repo/rules.json` en (via de workflow) opent een **draft-PR**.

Draait in `.github/workflows/phase2b-analyze.yml` (dagelijks + handmatig).

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
- Geen PII in PR's of analyse-records (alleen hostname + knop-teksten + categorie).
