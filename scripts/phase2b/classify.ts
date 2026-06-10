/**
 * Phase 2B — classificatie.
 *
 * Draait in Node en hergebruikt de ÉCHTE keyword-logica van de extensie
 * (normalize / isRejectText / …). Zo stelt de analyzer alleen keywords voor
 * die de extensie nu nog niet matcht, met exact dezelfde normalisatie.
 *
 * Roep eerst setRemoteKeywords(huidige rules.json) aan in de main, zodat
 * reeds-voorgestelde remote keywords ook meetellen als "al gematcht".
 */

import {
  normalize,
  isRejectText,
  isAmbiguousRejectText,
} from '../../src/lib/autoclick/keywords.ts';
import type { DetectionResult } from './detect.ts';

export type Category =
  | 'custom_unmatched'
  | 'tcf_or_cmp'
  | 'accept_only'
  | 'no_banner'
  | 'unknown';

export interface Classification {
  category: Category;
  /** Genormaliseerde keywords die we voorstellen toe te voegen (rejectKeywords). */
  proposedKeywords: string[];
  /** Korte uitleg voor de PR-body / het analyse-record. */
  reason: string;
  cmps: string[];
}

/**
 * Conservatieve weiger-indicatoren (substring op genormaliseerde tekst).
 * NL/EN/DE/FR/ES/IT. Bewust krap — liever een gemiste fix dan een fout keyword.
 */
const REJECT_INDICATORS = [
  'reject',
  'decline',
  'deny',
  'refuse',
  'do not accept',
  "don't accept",
  'necessary only',
  'only necessary',
  'essential only',
  'only essential',
  'continue without',
  'weiger',
  'afwijz',
  'alleen noodzakelijk',
  'alleen essentie',
  'ablehn',
  'nur notwendige',
  'notwendige nur',
  'refuser',
  'tout refuser',
  'rechaz',
  'rifiut',
  'solo necessari',
];

const ACCEPT_INDICATORS = [
  'accept',
  'agree',
  'allow all',
  'akkoord',
  'accepteer',
  'alles toestaan',
  'zustimmen',
  'akzeptier',
  'accepter',
  'tout accepter',
  'aceptar',
  'accetta',
  'got it',
  'i agree',
];

function hasAny(haystack: string, needles: string[]): boolean {
  return needles.some((n) => haystack.includes(n));
}

export function classify(d: DetectionResult): Classification {
  const cmps = d.cmps;

  if (!d.bannerVisible) {
    return {
      category: 'no_banner',
      proposedKeywords: [],
      reason:
        'Geen zichtbare consent-banner gevonden — waarschijnlijk al opgelost of niet reproduceerbaar.',
      cmps,
    };
  }

  // Kandidaat-knoppen analyseren.
  const proposed = new Set<string>();
  let hasMatchedReject = false;
  let hasAcceptOnly = false;

  for (const c of d.candidates) {
    const norm = normalize(c.text);
    if (!norm) continue;
    const isReject = isRejectText(c.text) || isAmbiguousRejectText(c.text);
    if (isReject) {
      hasMatchedReject = true;
      continue;
    }
    const looksReject = hasAny(norm, REJECT_INDICATORS);
    const looksAccept = hasAny(norm, ACCEPT_INDICATORS);
    if (looksReject && !looksAccept) {
      proposed.add(norm);
    } else if (looksAccept) {
      hasAcceptOnly = true;
    }
  }

  if (proposed.size > 0) {
    return {
      category: 'custom_unmatched',
      proposedKeywords: Array.from(proposed),
      reason:
        'Zichtbare custom-consent-banner met een weiger-knop die nog niet in de keyword-lijst staat.',
      cmps,
    };
  }

  if (d.hasTcf || cmps.length > 0) {
    return {
      category: 'tcf_or_cmp',
      proposedKeywords: [],
      reason: `TCF/CMP gedetecteerd (${d.hasTcf ? 'TCF' : ''}${
        cmps.length ? ' ' + cmps.join(', ') : ''
      }) maar banner bleef zichtbaar — vermoedelijk een dialect dat onze TCF/CMP-laag mist. Handmatige review.`,
      cmps,
    };
  }

  if (hasMatchedReject) {
    return {
      category: 'unknown',
      proposedKeywords: [],
      reason:
        'Banner zichtbaar met een knop die we wél zouden matchen — mogelijk timing/iframe. Handmatige review.',
      cmps,
    };
  }

  if (hasAcceptOnly) {
    return {
      category: 'accept_only',
      proposedKeywords: [],
      reason:
        'Banner lijkt alleen accepteer-knoppen te hebben, geen weiger-optie (accept-only, zie #69-73).',
      cmps,
    };
  }

  return {
    category: 'unknown',
    proposedKeywords: [],
    reason: 'Banner zichtbaar maar geen bruikbare knop-kandidaat herkend. Handmatige review.',
    cmps,
  };
}
