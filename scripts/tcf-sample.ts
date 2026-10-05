/**
 * Genereert een sample TCF v2 no-consent string en print 'm.
 *
 * Run:
 *   pnpm tcf:sample
 *
 * Validatie: `pnpm tcf:verify` decodeert de string met de officiële
 * IAB Tech Lab-bibliotheek. Handmatig: kopieer de output, plak 'm in
 * https://iabtcf.com/#/decode — alle velden moeten zonder errors
 * gelezen kunnen worden, en elke purpose/vendor/feature moet "false"
 * of "no consent" tonen.
 *
 * Vereist Node 22+ (vanwege `--experimental-strip-types`).
 */

import { generateNoConsentString } from '../src/lib/tcf/index.ts';

// Geen cmpId/vendorListVersion-overrides: de defaults in tcstring.ts
// zijn precies wat de extensie live uitstuurt.
const tcString = generateNoConsentString({
  cmpVersion: 1,
  consentLanguage: 'EN',
  publisherCC: 'NL',
});

console.log('═══════════════════════════════════════════════════════════');
console.log(' BannerBye — TCF v2 no-consent sample string');
console.log('═══════════════════════════════════════════════════════════');
console.log();
console.log('  ' + tcString);
console.log();
console.log('  Length: ' + tcString.length + ' chars');
console.log('  Segments: ' + tcString.split('.').length + ' (core + DisclosedVendors)');
console.log();
console.log('  Decode at: https://iabtcf.com/#/decode');
console.log();
console.log('  Verwachting bij decode:');
console.log('   - Version: 2');
console.log('   - TCF Policy Version: 5');
console.log('   - CMP ID: 4095 (sentinel, niet geregistreerd)');
console.log('   - Is Service Specific: true');
console.log('   - All purposes: NO');
console.log('   - All special features: NO');
console.log('   - All vendors: NO consent');
console.log('   - Disclosed vendors: none');
console.log();
