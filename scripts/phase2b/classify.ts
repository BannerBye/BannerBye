/**
 * Phase 2B/2C — classificatie (incl. accept-only / step-into, #69-73).
 *
 * Draait in Node en hergebruikt de ÉCHTE keyword-logica van de extensie
 * (normalize / isRejectText / isStepIntoText / …). Zo stelt de analyzer alleen
 * keywords voor die de extensie nu nog niet matcht, met dezelfde normalisatie.
 *
 * Twee-staps consent (dark patterns, "Customize / Accept All"): als er geen
 * directe weiger-knop is maar wél een step-into knop, geeft classify()
 * category `needs_step_into` + de knop-tekst terug. analyze.ts klikt die in
 * Playwright, en classifyStepPanel() beoordeelt daarna het geopende paneel.
 *
 * Roep eerst setRemoteKeywords(huidige rules.json) aan in de main.
 */

import {
  normalize,
  isRejectText,
  isAmbiguousRejectText,
  isStepIntoText,
} from '../../src/lib/autoclick/keywords.ts';
import type { DetectionResult } from './detect.ts';

export type Category =
  | 'custom_unmatched'
  | 'needs_step_into'
  | 'step_into'
  | 'tcf_or_cmp'
  | 'accept_only'
  | 'no_banner'
  | 'unknown';

/** Doellijst in rules.json waar een voorgesteld keyword heen gaat. */
export type KeywordList = 'reject' | 'ambiguous' | 'stepInto';

export interface KeywordProposal {
  keyword: string;
  list: KeywordList;
}

export interface Classification {
  category: Category;
  proposals: KeywordProposal[];
  reason: string;
  cmps: string[];
  /** Alleen bij needs_step_into: de knop-tekst die analyze.ts moet klikken. */
  stepIntoButtonText?: string;
}

/** Weiger-indicatoren (substring op genormaliseerde tekst). Bewust krap. */
const REJECT_INDICATORS = [
  'reject', 'decline', 'deny', 'refuse', 'do not accept', "don't accept",
  'necessary only', 'only necessary', 'essential only', 'only essential',
  'continue without', 'weiger', 'afwijz', 'alleen noodzakelijk',
  'alleen essentie', 'ablehn', 'nur notwendige', 'notwendige nur',
  'refuser', 'tout refuser', 'rechaz', 'rifiut', 'solo necessari',
];

const ACCEPT_INDICATORS = [
  'accept', 'agree', 'allow all', 'akkoord', 'accepteer', 'alles toestaan',
  'zustimmen', 'akzeptier', 'accepter', 'tout accepter', 'aceptar',
  'accetta', 'got it', 'i agree',
];

/** Step-into indicatoren: knoppen die naar een detail-paneel leiden. */
const STEP_INTO_INDICATORS = [
  'customize', 'customise', 'manage', 'more options', 'more choices',
  'options', 'preferences', 'settings', 'purposes', 'show details',
  'meer opties', 'instellingen', 'opties', 'aanpassen', 'beheren',
  'voorkeuren', 'personali', 'einstellungen', 'optionen', 'mehr optionen',
  'paramètres', 'personnaliser', 'gérer', 'impostazioni', 'più opzioni',
];

/** Save/confirm-stijl knoppen (post-step-into, ambigu). */
const SAVE_INDICATORS = [
  'save', 'opslaan', 'confirm', 'bevestig', 'speichern', 'enregistrer',
  'guardar', 'salva', 'my choices', 'my selection', 'my preferences',
  'keuzes', 'selectie', 'voorkeuren', 'auswahl', 'mes choix',
];

function hasAny(haystack: string, needles: string[]): boolean {
  return needles.some((n) => haystack.includes(n));
}

/** Eerste-fase classificatie op de banner zelf. */
export function classify(d: DetectionResult): Classification {
  const cmps = d.cmps;

  if (!d.bannerVisible) {
    return {
      category: 'no_banner',
      proposals: [],
      reason:
        'Geen zichtbare consent-banner gevonden — waarschijnlijk al opgelost of niet reproduceerbaar.',
      cmps,
    };
  }

  const rejectProposals: KeywordProposal[] = [];
  let hasMatchedReject = false;
  let hasAcceptOnly = false;
  let stepIntoButtonText: string | undefined;

  for (const c of d.candidates) {
    const norm = normalize(c.text);
    if (!norm) continue;
    if (isRejectText(c.text) || isAmbiguousRejectText(c.text)) {
      hasMatchedReject = true;
      continue;
    }
    const looksReject = hasAny(norm, REJECT_INDICATORS);
    const looksAccept = hasAny(norm, ACCEPT_INDICATORS);
    if (looksReject && !looksAccept) {
      rejectProposals.push({ keyword: norm, list: 'reject' });
      continue;
    }
    if (looksAccept) hasAcceptOnly = true;
    // Onthoud een step-into kandidaat (niet-accept) voor fase 2.
    if (!stepIntoButtonText && !looksAccept) {
      if (isStepIntoText(c.text) || hasAny(norm, STEP_INTO_INDICATORS)) {
        stepIntoButtonText = c.text;
      }
    }
  }

  // Directe weiger-knop met onbekende tekst → meteen voorstellen.
  if (rejectProposals.length > 0) {
    return {
      category: 'custom_unmatched',
      proposals: dedupe(rejectProposals),
      reason:
        'Zichtbare custom-consent-banner met een weiger-knop die nog niet in de keyword-lijst staat.',
      cmps,
    };
  }

  // Geen directe reject, maar wél een step-into knop → fase 2 (analyze.ts klikt).
  if (stepIntoButtonText) {
    return {
      category: 'needs_step_into',
      proposals: [],
      reason: `Geen directe weiger-knop; step-into knop "${stepIntoButtonText}" gevonden — paneel wordt geopend om binnenin te zoeken.`,
      cmps,
      stepIntoButtonText,
    };
  }

  if (d.hasTcf || cmps.length > 0) {
    return {
      category: 'tcf_or_cmp',
      proposals: [],
      reason: `TCF/CMP gedetecteerd (${d.hasTcf ? 'TCF' : ''}${
        cmps.length ? ' ' + cmps.join(', ') : ''
      }) maar banner bleef zichtbaar — vermoedelijk een dialect dat onze TCF/CMP-laag mist. Handmatige review.`,
      cmps,
    };
  }
  if (hasMatchedReject) {
    return {
      category: 'unknown',
      proposals: [],
      reason:
        'Banner zichtbaar met een knop die we wél zouden matchen — mogelijk timing/iframe. Handmatige review.',
      cmps,
    };
  }
  if (hasAcceptOnly) {
    return {
      category: 'accept_only',
      proposals: [],
      reason:
        'Banner lijkt alleen accepteer-knoppen te hebben, geen weiger-optie en geen step-into. Echt accept-only — niet oplosbaar via klikken.',
      cmps,
    };
  }
  return {
    category: 'unknown',
    proposals: [],
    reason: 'Banner zichtbaar maar geen bruikbare knop-kandidaat herkend. Handmatige review.',
    cmps,
  };
}

/**
 * Tweede-fase classificatie op het geopende detail-paneel (na step-into klik).
 * Zoekt de weiger/save-knop binnenin en stelt keywords voor. Als de step-into
 * knop zelf nog niet gematcht was, wordt die óók voorgesteld (list: stepInto)
 * zodat de extensie het paneel voortaan kan openen.
 */
export function classifyStepPanel(
  d: DetectionResult,
  stepIntoButtonText: string,
  cmps: string[],
): Classification {
  const proposals: KeywordProposal[] = [];
  let hasMatchedReject = false;

  for (const c of d.candidates) {
    const norm = normalize(c.text);
    if (!norm) continue;
    if (isRejectText(c.text) || isAmbiguousRejectText(c.text)) {
      hasMatchedReject = true;
      continue;
    }
    const looksAccept = hasAny(norm, ACCEPT_INDICATORS);
    if (looksAccept) continue;
    if (hasAny(norm, REJECT_INDICATORS)) {
      proposals.push({ keyword: norm, list: 'reject' });
    } else if (hasAny(norm, SAVE_INDICATORS)) {
      proposals.push({ keyword: norm, list: 'ambiguous' });
    }
  }

  const stepIntoUnmatched = !isStepIntoText(stepIntoButtonText);
  const usefulPanel = proposals.length > 0 || hasMatchedReject;

  // Als het paneel bruikbaar is maar de step-into knop nog niet gematcht was,
  // is DAT de ontbrekende schakel — stel de step-into knop voor.
  if (stepIntoUnmatched && usefulPanel) {
    const s = normalize(stepIntoButtonText);
    if (s) proposals.unshift({ keyword: s, list: 'stepInto' });
  }

  if (proposals.length > 0) {
    return {
      category: 'step_into',
      proposals: dedupe(proposals),
      reason: `Step-into paneel (via "${stepIntoButtonText}") bevat een weiger/save-knop die nog niet gedekt was.`,
      cmps,
    };
  }

  return {
    category: hasMatchedReject ? 'unknown' : 'accept_only',
    proposals: [],
    reason: hasMatchedReject
      ? `Step-into paneel geopend; weiger-knop wél herkend — mogelijk timing. Handmatige review.`
      : `Step-into paneel geopend maar geen weiger/save-knop gevonden — mogelijk toggle-based of echt accept-only. Handmatige review.`,
    cmps,
  };
}

function dedupe(proposals: KeywordProposal[]): KeywordProposal[] {
  const seen = new Set<string>();
  const out: KeywordProposal[] = [];
  for (const p of proposals) {
    const key = `${p.list}:${p.keyword}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}
