/**
 * Regressietests voor classify(): echte banners die eerder verkeerd werden
 * ingedeeld. Voeg bij elke misser een geval toe met de knoppen uit de mail.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../classify.ts';
import { setRemoteKeywords, isRejectText } from '../../../src/lib/autoclick/keywords.ts';
import type { DetectionResult } from '../detect.ts';

setRemoteKeywords({}, 'test.example');

function det(texts: string[], pageLang = ''): DetectionResult {
  return {
    finalUrl: 'https://test.example/',
    cmps: [],
    hasTcf: false,
    bannerVisible: true,
    candidates: texts.map((text) => ({ text }) as DetectionResult['candidates'][number]),
    bannerTextSnippet: '',
    weakSignal: false,
    pageLang,
  };
}

test('freeletics.com (18 nov): "Nur notwendige Cookies akzeptieren" is een weigerknop', () => {
  assert.equal(isRejectText('Nur notwendige Cookies akzeptieren'), true);
  const c = classify(det(['Freeletics Cookie- und Datenschutzrichtlinie', 'Alle Cookies akzeptieren', 'Nur notwendige Cookies akzeptieren'], 'de'));
  assert.notEqual(c.category, 'accept_only');
});

test('beperkte accept-knoppen in andere talen worden voorgesteld, niet accept-only', () => {
  for (const [accept, limited] of [
    ['Accept all', 'Accept only necessary cookies please'],
    ['Alles accepteren', 'Accepteer alleen noodzakelijke cookies hier'],
    ['Accetta tutto', 'Accetta solo i necessari per ora'],
    ['Alle akzeptieren', 'Nur erforderliche Cookies akzeptieren bitte'],
  ]) {
    const c = classify(det([accept, limited]));
    assert.notEqual(c.category, 'accept_only', limited);
  }
});

test('echt accept-only blijft accept-only (mocospace.com: alleen "Got it!")', () => {
  assert.equal(classify(det(['Alle akzeptieren'])).category, 'accept_only');
  assert.equal(classify(det(['Accept all cookies'])).category, 'accept_only');
});

test('"Alle Cookies akzeptieren" telt nooit als weigerknop', () => {
  assert.equal(isRejectText('Alle Cookies akzeptieren'), false);
  assert.equal(isRejectText('Cookies akzeptieren'), false);
});
