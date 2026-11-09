/**
 * Pijplijn v2 — offline test van het snapshot-pad (geen browser, geen Redis):
 *   node --experimental-strip-types test-evidence.ts
 *
 * Nagespeeld naar de newdaycards-casus van 9 nov 2026: melder op Android ziet
 * op /aqua/login een custom banner met een accepteer- en een instellingen-knop;
 * headless ziet niets (root is 404). De instellingen-knop heeft een label dat
 * de extensie nog niet kent. v1 noemde dit "vals positief"; v2 moet uit de
 * snapshot zelf de ontbrekende step-into-knop voorstellen, host-scoped.
 */

import assert from 'node:assert/strict';
import { setRemoteKeywords, normalize, isStepIntoText } from '../../src/lib/autoclick/keywords.ts';
import { classify } from './classify.ts';
import { detectionFromSnapshot, safePath } from './evidence.ts';
import { mergeHostProposals, hostRuleKeywordsSeenOn, type RemoteRules } from './rules.ts';
import type { ReportSnapshot } from './redis.ts';

const HOST = 'portal.example-bank.com';
const STEP_LABEL = 'Adjust cookie choices';

const snapshot: ReportSnapshot = {
  v: 1,
  at: Date.now(),
  candidates: [
    { text: 'Accept everything', tag: 'button', inBanner: true, attrs: ['btn', 'accept'] },
    { text: STEP_LABEL, tag: 'button', inBanner: true, attrs: ['btn', 'manage'] },
    { text: 'Log in', tag: 'button', inBanner: false },
  ],
  bannerFound: true,
  bannerText: `We use cookies to make our site work and to improve your experience. Accept everything ${STEP_LABEL}`,
  cmps: [],
  iframes: [],
  pageLang: 'en',
  uiLang: 'nl-NL',
  viewport: { w: 412, h: 915 },
  totalClickables: 9,
};

// 1. Pad-opschoning
assert.equal(safePath('/aqua/login'), '/aqua/login');
assert.equal(safePath('/x?y=1'), '/');
assert.equal(safePath(undefined), '/');

// 2. Snapshot → detectie-vorm
setRemoteKeywords({ rejectKeywords: [], ambiguousKeywords: [], stepIntoKeywords: [] }, HOST);
assert.equal(isStepIntoText(STEP_LABEL), false, 'testlabel moet nog ongedekt zijn');
const det = detectionFromSnapshot(HOST, { path: '/aqua/login' }, snapshot);
assert.ok(det, 'snapshot met banner levert een detectie op');
assert.equal(det.bannerVisible, true);
assert.equal(det.candidates.length, 2, 'alleen de knoppen ín de banner');
assert.equal(det.finalUrl, `https://${HOST}/aqua/login`);

// 3. Classificatie vindt de instellingen-knop
const cls = classify(det);
assert.equal(cls.category, 'needs_step_into', `verwacht needs_step_into, kreeg ${cls.category}: ${cls.reason}`);
assert.equal(cls.stepIntoButtonText, STEP_LABEL);

// 4. Snapshot-fallback (zoals analyze.ts doet): knop zelf voorstellen als stepInto
const proposal = { keyword: normalize(STEP_LABEL), list: 'stepInto' as const };
assert.equal(proposal.keyword, 'adjust cookie choices');

// 5. Host-scoped toepassen → alleen deze host, niet globaal
const rules: RemoteRules = { version: 1, autoclick: { rejectKeywords: [], ambiguousKeywords: [], stepIntoKeywords: ['manage cookies'] } };
const { added } = mergeHostProposals(rules, HOST, [proposal, { keyword: 'manage cookies', list: 'stepInto' }]);
assert.deepEqual(added, [proposal], 'globaal al bekende keywords worden niet nog eens host-scoped gezet');
assert.deepEqual(rules.autoclick!.hostRules![HOST]!.stepIntoKeywords, ['adjust cookie choices']);
assert.deepEqual(rules.autoclick!.stepIntoKeywords, ['manage cookies'], 'globale lijst onaangeroerd');

// 6. Na de host-regel kent de matcher 'm wél op deze host, en niet elders
setRemoteKeywords(rules.autoclick!, HOST);
assert.equal(isStepIntoText(STEP_LABEL), true);
setRemoteKeywords(rules.autoclick!, 'other.example');
assert.equal(isStepIntoText(STEP_LABEL), false);

// 7. Zelfde keyword op een tweede host → globale kandidaat voor de PR
mergeHostProposals(rules, 'shop.example.org', [proposal]);
const global = hostRuleKeywordsSeenOn(rules, 2);
assert.deepEqual(global.map((g) => g.keyword), ['adjust cookie choices']);
assert.deepEqual(global[0]!.hosts, [HOST, 'shop.example.org']);
assert.deepEqual(hostRuleKeywordsSeenOn(rules, 3), []);

// 8. Snapshot zonder container en zonder bannertekst is te mager
assert.equal(detectionFromSnapshot(HOST, { path: '/' }, { ...snapshot, bannerFound: false, bannerText: '', candidates: snapshot.candidates.map((c) => ({ ...c, inBanner: false })) }), null);

console.log('test-evidence: alle 8 controles geslaagd ✔');
