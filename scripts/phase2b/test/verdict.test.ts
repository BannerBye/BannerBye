/**
 * Regels uit verdict.ts. Elk geval hier is een echte melding waarbij de
 * pijplijn ten onrechte "niets aan de hand" zei, of de grens ervan.
 * Draaien: node --experimental-strip-types --test scripts/phase2b/test/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideVerdict, nothingToDo, safeExplanation, type ExtensionCheck } from '../verdict.ts';

const extOk: ExtensionCheck = { ran: true, bannerStill: false, navigations: 1, loop: false, note: 'banner verdween' };
const extStill: ExtensionCheck = { ran: true, bannerStill: true, navigations: 1, loop: false, note: 'banner bleef staan' };
const extLoop: ExtensionCheck = { ran: true, bannerStill: false, navigations: 23, loop: true, note: 'herlaadlus' };
const extFailed: ExtensionCheck = { ran: false, bannerStill: true, navigations: 30, loop: true, note: 'faalde' };

test('freeletics.com (18 nov): accept-only zonder tweede controle sluit niet', () => {
  const v = decideVerdict({ base: 'accept_only' });
  assert.equal(v.ticket, 'investigating');
  assert.equal(v.needsRobin, true);
  assert.equal(v.kind, 'unverified_close');
});

test('freeletics.com: tweede controle ziet "Nur notwendige Cookies akzeptieren" → weersproken', () => {
  const v = decideVerdict({ base: 'accept_only', refuseRoute: { result: 'found', button: 'Nur notwendige Cookies akzeptieren', reason: 'alleen noodzakelijk' } });
  assert.equal(v.kind, 'misclassified');
  assert.equal(v.ticket, 'investigating');
  assert.equal(v.needsRobin, true);
});

test('twijfel van de tweede controle sluit nooit', () => {
  for (const base of ['accept_only', 'wall'] as const) {
    const v = decideVerdict({ base, refuseRoute: { result: 'unsure', reason: 'Claude HTTP 529' } });
    assert.equal(v.ticket, 'investigating');
    assert.equal(v.needsRobin, true);
  }
});

test('mocospace.com (3 nov): echt accept-only, bevestigd → not-a-bug, niets te doen', () => {
  const v = decideVerdict({ base: 'accept_only', refuseRoute: { result: 'none', reason: 'alleen "Got it!"' }, extension: extStill });
  assert.equal(v.ticket, 'not-a-bug');
  assert.equal(v.needsRobin, false);
});

test('chefkoch.de (12 nov): bevestigde betaalmuur → not-a-bug', () => {
  const v = decideVerdict({ base: 'wall', refuseRoute: { result: 'none', reason: 'toestemmen of abonneren' } });
  assert.equal(v.ticket, 'not-a-bug');
  assert.equal(v.needsRobin, false);
});

test('reactormag.com/duckduckgo.com: een lus is altijd een bug, ook op een "muur"', () => {
  const v = decideVerdict({ base: 'wall', refuseRoute: { result: 'none', reason: 'muur' }, extension: extLoop });
  assert.equal(v.ticket, 'investigating');
  assert.equal(v.needsRobin, true);
  assert.equal(v.confirmedBroken, true);
});

test('twinseasons.de (4 nov): "knop herkend, mogelijk timing" is werk voor Robin', () => {
  const v = decideVerdict({ base: 'unknown', extension: extStill });
  assert.equal(v.needsRobin, true);
  assert.equal(v.confirmedBroken, true);
  assert.equal(v.ticket, 'investigating');
});

test('een geslaagde extensiecheck sluit niets (melder zat misschien op Safari)', () => {
  for (const base of ['unknown', 'cmp_iframe', 'language_gap', 'rejected', 'error', 'needs_human', 'review'] as const) {
    const v = decideVerdict({ base, extension: extOk });
    assert.equal(v.needsRobin, true, base);
    assert.equal(v.ticket, 'investigating', base);
  }
});

test('een mislukte extensiecheck telt nergens als bewijs', () => {
  const v = decideVerdict({ base: 'unknown', extension: extFailed });
  assert.equal(v.confirmedBroken, false);
  assert.equal(v.needsRobin, true);
  const w = decideVerdict({ base: 'accept_only', refuseRoute: { result: 'none', reason: 'ok' }, extension: extFailed });
  assert.equal(w.ticket, 'not-a-bug');
});

test('live en herhaalpoging vragen niets van Robin; ticket juist', () => {
  assert.deepEqual(decideVerdict({ base: 'live' }), { kind: 'live', ticket: 'fixed', needsRobin: false, confirmedBroken: false });
  const r = decideVerdict({ base: 'retry' });
  assert.equal(r.needsRobin, false);
  assert.equal(r.ticket, 'investigating');
});

test('"niets te doen" alleen als geen enkele host Robin nodig heeft', () => {
  assert.equal(nothingToDo([decideVerdict({ base: 'live' }), decideVerdict({ base: 'retry' })]), true);
  assert.equal(nothingToDo([decideVerdict({ base: 'live' }), decideVerdict({ base: 'accept_only' })]), false);
});

test('freeletics-mail: geruststellende duiding verdwijnt als Robin moet kijken', () => {
  const needs = decideVerdict({ base: 'accept_only' });
  const text = 'de melder hoeft niets te doen, dit is een bekend patroon dat Freeletics mogelijk niet volledig implementeert.';
  assert.equal(safeExplanation(text, needs), '');
  const fine = decideVerdict({ base: 'live' });
  assert.equal(safeExplanation('Opgelost, niets te doen.', fine), 'Opgelost, niets te doen.');
  assert.equal(safeExplanation('De weigerknop werkt hier niet.', needs), 'De weigerknop werkt hier niet.');
});
