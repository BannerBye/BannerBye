/**
 * Verifieert de BannerBye no-consent TC-string met de officiële
 * IAB Tech Lab-decoder (`@iabtechlabtcf/core`). Faalt hard (exit 1)
 * zodra een veld afwijkt van wat we beloven, zodat een regressie in
 * tcstring.ts nooit ongemerkt een release in glipt.
 *
 * Run:
 *   pnpm tcf:verify
 *
 * Achtergrond (5 okt 2026): de string van 0.1.0 t/m 0.4.7 werd door
 * deze decoder geweigerd ("invalid value 0 passed for cmpId"), was
 * global-scoped (sinds sept 2021 niet toegestaan) en miste het
 * DisclosedVendors-segment dat v2.3 sinds 28 feb 2026 verplicht stelt.
 * Alles wat deze decoder gebruikt, gooide onze string dus weg.
 *
 * Vereist Node 22+ (vanwege `--experimental-strip-types`).
 */

import { TCString } from '@iabtechlabtcf/core';
import { generateNoConsentString } from '../src/lib/tcf/index.ts';
import { buildNoConsentTCData } from '../src/lib/tcf/tcdata.ts';
import { TCF_POLICY_VERSION, UNREGISTERED_CMP_ID } from '../src/lib/tcf/tcstring.ts';

const failures: string[] = [];
const check = (label: string, ok: boolean, detail = ''): void => {
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

const tcString = generateNoConsentString({ nowMs: Date.now() });
console.log('═══════════════════════════════════════════════════════════');
console.log(' BannerBye — TCF verify (@iabtechlabtcf/core)');
console.log('═══════════════════════════════════════════════════════════');
console.log();
console.log('  ' + tcString);
console.log();

// 1. Structuur
const segments = tcString.split('.');
check('two segments (core + DisclosedVendors)', segments.length === 2, `${segments.length}`);
check('no base64 padding', !tcString.includes('='));

// 2. Decode met de referentiebibliotheek
let model: ReturnType<typeof TCString.decode> | null = null;
try {
  model = TCString.decode(tcString);
  check('reference decoder accepts string', true);
} catch (err) {
  check('reference decoder accepts string', false, String(err));
}

if (model) {
  check('version 2', model.version === 2, `${model.version}`);
  check(
    `policyVersion ${TCF_POLICY_VERSION}`,
    model.policyVersion === TCF_POLICY_VERSION,
    `${model.policyVersion}`,
  );
  check(`cmpId ${UNREGISTERED_CMP_ID}`, model.cmpId === UNREGISTERED_CMP_ID, `${model.cmpId}`);
  check('isServiceSpecific true', model.isServiceSpecific === true);
  check('useNonStandardTexts false', model.useNonStandardTexts === false);
  check('purposeOneTreatment false', model.purposeOneTreatment === false);
  check('consentLanguage EN', model.consentLanguage === 'EN', model.consentLanguage);

  const anyTrue = (v: { forEach: (cb: (val: boolean, id: number) => void) => void }): number => {
    let n = 0;
    v.forEach((val) => {
      if (val) n += 1;
    });
    return n;
  };
  check('no purpose consents', anyTrue(model.purposeConsents) === 0);
  check('no purpose legitimate interests', anyTrue(model.purposeLegitimateInterests) === 0);
  check('no special feature opt-ins', anyTrue(model.specialFeatureOptins) === 0);
  check('no vendor consents', anyTrue(model.vendorConsents) === 0);
  check('no vendor legitimate interests', anyTrue(model.vendorLegitimateInterests) === 0);
  check('no disclosed vendors', anyTrue(model.vendorsDisclosed) === 0);
  check('no publisher restrictions', model.publisherRestrictions.numRestrictions === 0);

  const ageMs = Date.now() - model.created.getTime();
  check('created within last minute', ageMs >= 0 && ageMs < 60_000, `${Math.round(ageMs)} ms`);
}

// 3. TCData-object moet hetzelfde zeggen als de string
const tcData = buildNoConsentTCData();
check('tcData.cmpId matches string', tcData.cmpId === UNREGISTERED_CMP_ID);
check('tcData.isServiceSpecific true', tcData.isServiceSpecific === true);
check('tcData.tcfPolicyVersion matches', tcData.tcfPolicyVersion === TCF_POLICY_VERSION);
check('tcData.tcString has two segments', tcData.tcString.split('.').length === 2);

console.log();
if (failures.length > 0) {
  console.log(`  ${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log('  All checks passed.');
