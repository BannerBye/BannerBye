# Phase 2B — keyword-voorstel publiceren naar productie

De GitHub Action wijzigt alleen de **canonieke** `repo/rules.json` via een draft-PR.
De live `rules.json` op bannerbye.com wordt geserveerd vanuit de **deploy-folder**
(handmatige Vercel-deploy). Na het mergen van een PR publiceer je zo:

```
# vanuit de project-root (waar repo/ en deploy/ naast elkaar staan)
cp repo/rules.json deploy/rules.json
cd deploy && vercel --prod
```

Controleer daarna:

```
curl -s https://bannerbye.com/rules.json
```

De extensie haalt `rules.json` één keer per dag op (chrome.alarms), dus nieuwe
keywords zijn binnen ~24u bij alle gebruikers actief — zonder store-review.

> **Latere verbetering:** Vercel rechtstreeks `repo/rules.json` laten serveren,
> dan vervalt deze handmatige sync. Bewust uitgesteld (buiten 2B-scope).
