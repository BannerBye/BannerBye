/**
 * v0.4.19 — offline tests: bezwaarlaag-keywords, derde route, vraag-opnieuw-teller.
 *   node --experimental-strip-types scripts/tests/test-0419.ts
 */
import assert from 'node:assert/strict';
import { isObjectText, isRejectText, isAmbiguousRejectText } from '../../src/lib/autoclick/keywords.ts';
import { nextReasks } from '../../src/lib/reask.ts';
import { REASK_MIN_GAP_MS, REASK_TTL_MS, REASK_CAP } from '../../src/lib/types.ts';

// Bezwaarlaag: alleen "alles"-varianten, nooit een losse per-vendor-knop.
for (const t of ['Object all', 'OBJECT TO ALL', 'Allen widersprechen', "S'opposer à tout", 'Bezwaar maken tegen alles', 'Opponiti a tutto']) {
  assert.equal(isObjectText(t), true, t);
}
for (const t of ['Object', 'Widersprechen', 'Accept all', 'Alles accepteren']) {
  assert.equal(isObjectText(t), false, t);
}
// Een bezwaarknop is geen weigerknop (anders slaat PASS 1 'm al over de kop).
assert.equal(isRejectText('Object all'), false);
// Na de bezwaarklik moet "Save & exit"-achtig herkend blijven.
assert.equal(isAmbiguousRejectText('Save'), true);

// Derde route: gratis weigerroute naast een betaalknop is een weigerknop.
for (const t of ['Continua senza accettare', 'Weiter ohne Einwilligung', 'Doorgaan zonder te accepteren', 'Continuer sans consentir', 'Continue without agreeing']) {
  assert.equal(isRejectText(t), true, t);
}
// …maar betalen blijft nooit een weigerknop.
assert.equal(isRejectText('Rifiuta e Sostienici'), false);

// Vraag-opnieuw-teller.
const t0 = 1_800_000_000_000;
let list = nextReasks([], 'nu.nl', t0);
assert.deepEqual(list[0], { host: 'nu.nl', firstAt: t0, lastAt: t0, reasks: 0 });
list = nextReasks(list, 'nu.nl', t0 + 60_000); // zelfde bezoek
assert.equal(list[0].reasks, 0);
list = nextReasks(list, 'nu.nl', t0 + 60_000 + REASK_MIN_GAP_MS); // nieuw bezoek
assert.equal(list[0].reasks, 1);
assert.equal(list[0].firstAt, t0);
// Vervallen regels verdwijnen.
list = nextReasks(list, 'ad.nl', t0 + REASK_TTL_MS * 2);
assert.equal(list.find((e) => e.host === 'nu.nl'), undefined);
// Cap.
let big: ReturnType<typeof nextReasks> = [];
for (let i = 0; i < REASK_CAP + 20; i++) big = nextReasks(big, `s${i}.example`, t0 + i);
assert.equal(big.length, REASK_CAP);
assert.equal(big[0].host, `s${REASK_CAP + 19}.example`);

// Handmatige indexcontrole 21 nov: pijl, typografische apostrof, Frans.
for (const t of ['Continuer sans accepter →', 'Je n’accepte rien', "Je n'accepte rien", 'Refuser les cookies optionnels', '› Weigeren']) {
  assert.equal(isRejectText(t), true, t);
}
assert.equal(isRejectText('Accepter →'), false);

console.log('test-0419: all checks passed');
