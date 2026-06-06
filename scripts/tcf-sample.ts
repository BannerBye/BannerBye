/**
 * Genereert een sample TCF v2.2 no-consent string en print 'm.
 *
 * Run:
 *   pnpm tcf:sample
 *
 * Validatie: kopieer de output, plak 'm in https://iabtcf.com/#/decode
 * — alle velden moeten zonder errors gelezen kunnen worden, en
 * elke purpose/vendor/feature moet "false" of "no consent" tonen.
 *
 * Vereist Node 22+ (vanwege `--experimental-strip-types`).
 */

import { generateNoConsentString } from '../src/lib/tcf/index.ts';

const tcString = generateNoConsentString({
  cmpId: 0,
  cmpVersion: 1,
  vendorListVersion: 1,
  consentLanguage: 'EN',
  publisherCC: 'NL',
});

console.log('═══════════════════════════════════════════════════════════');
console.log(' BannerBye — TCF v2.2 no-consent sample string');
console.log('═══════════════════════════════════════════════════════════');
console.log();
console.log('  ' + tcString);
console.log();
console.log('  Length: ' + tcString.length + ' chars');
console.log();
console.log('  Decode at: https://iabtcf.com/#/decode');
console.log();
console.log('  Verwachting bij decode:');
console.log('   - Version: 2');
console.log('   - TCF Policy Version: 4');
console.log('   - All purposes: NO');
console.log('   - All special features: NO');
console.log('   - All vendors: NO consent');
console.log();
