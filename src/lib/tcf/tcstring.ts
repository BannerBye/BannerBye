/**
 * IAB TCF v2.2 TC-string generator.
 *
 * BannerBye stuurt naar elke pagina dezelfde "no-consent"-string:
 *  - Geen consent voor enige purpose (1..24)
 *  - Geen opt-in op enige special feature (1..12)
 *  - Geen vendor-consent (BitField met MaxVendorId=0)
 *  - Geen vendor legitimate interest acknowledgement
 *  - Geen publisher restrictions
 *
 * De string wordt aan sites geserveerd via `__tcfapi` (in een
 * volgende taak) en/of als `euconsent-v2`-cookie. Het IAB Europe
 * Transparency & Consent Framework verplicht CMP-compatible sites
 * om dit signal te respecteren.
 *
 * Format-spec:
 *   https://github.com/InteractiveAdvertisingBureau/GDPR-Transparency-and-Consent-Framework/blob/master/TCFv2/IAB%20Tech%20Lab%20-%20Consent%20string%20and%20vendor%20list%20formats%20v2.md
 *
 * TCF v2.2 wijzigingen tov v2.0/v2.1:
 *  - Policy version is 4 (was 2 voor v2.0, 3 voor v2.1)
 *  - Purpose 1 is herzien (geen "use limited data" meer)
 *  - Purposes-Consent blijft 24 bits (backward compat)
 *
 * Validatie: produceer een string en gooi 'm in https://iabtcf.com/#/decode
 * — alle velden moeten gelezen kunnen worden zonder errors.
 */

import { BitWriter } from './bitwriter.ts';

/** TCF Core String version field. v2-strings beginnen altijd met 2. */
const TCF_VERSION = 2;

/**
 * TCF Policy Version voor TCF v2.2 (current revision).
 * Initial v2.2 was 4. IAB heeft het opgehoogd naar 5 voor strenger
 * vendor-list-checking. Echte CMPs (OneTrust, Didomi) verwachten 5;
 * met 4 wordt onze string als "verlopen" gerejecteerd.
 */
const TCF_POLICY_VERSION = 5;

/**
 * Realistische MaxVendorId voor de vendor-secties.
 * De echte IAB GVL bevat ~360+ vendors. Met 0 zegt onze string
 * "ik weet van geen enkele vendor", wat strenge CMPs verwerpen.
 * 1000 is een veilige bovengrens — alle vendors die de GVL ooit
 * heeft gehad passen hierbinnen.
 */
const VENDOR_MAX_ID = 1000;

export interface TCStringOptions {
  /**
   * CMP ID toegekend door IAB Europe.
   * 0 = niet-geregistreerde / test-CMP. Bij publieke launch:
   * registreren via https://iabeurope.eu/cmp-list/ en assigned ID gebruiken.
   */
  cmpId?: number;

  /** CMP-implementatieversie. Verhoog bij breaking changes in onze string-output. */
  cmpVersion?: number;

  /** Vendor-list-versie waar deze string mee correspondeert. Update periodiek. */
  vendorListVersion?: number;

  /** ISO 639-1 taalcode (2 letters), bijv. "EN", "NL". */
  consentLanguage?: string;

  /**
   * ISO 3166-1 alpha-2 landcode van de publisher.
   * "AA" = onbekend (gereserveerd voor user-defined).
   */
  publisherCC?: string;

  /**
   * Override voor `Date.now()` — handig voor deterministische tests.
   * 0 (default) = gebruik echte tijd.
   */
  nowMs?: number;
}

const DEFAULTS: Required<TCStringOptions> = {
  cmpId: 0,
  cmpVersion: 1,
  // Realistische vendor-list-versie. De echte GVL wordt wekelijks
  // gepubliceerd; we kiezen een nummer dat "recent genoeg" oogt voor
  // strenge parsers maar niet zo specifiek dat 'ie binnen een week
  // achterhaald is. Bij grote desync update'en in remote rule-set.
  vendorListVersion: 350,
  consentLanguage: 'EN',
  publisherCC: 'AA',
  nowMs: 0,
};

/**
 * Genereert een TCF v2.2 "no-consent" Core String.
 *
 * De Core String is het minimum dat nodig is — Disclosed Vendors,
 * Allowed Vendors en Publisher TC segmenten zijn optioneel en niet
 * relevant voor "weiger alles". Sites die meer segmenten verwachten
 * moeten omgaan met core-only strings (spec-vereiste).
 *
 * @returns base64url-encoded string zonder padding (~50-60 chars).
 */
export function generateNoConsentString(opts: TCStringOptions = {}): string {
  const o = { ...DEFAULTS, ...opts };
  const now = o.nowMs > 0 ? o.nowMs : Date.now();
  const w = new BitWriter();

  // === CORE SEGMENT ===
  // Volgorde en bit-lengtes zijn vastgelegd in de TCF-spec.
  // Wijk niet af zonder de spec opnieuw te checken.

  w.writeNumber(TCF_VERSION, 6); // Version
  w.writeDeciseconds(now); // Created (36 bits)
  w.writeDeciseconds(now); // LastUpdated (36 bits)
  w.writeNumber(o.cmpId, 12); // CmpId
  w.writeNumber(o.cmpVersion, 12); // CmpVersion
  w.writeNumber(0, 6); // ConsentScreen — 0 = no UI shown to user (we don't ask)
  w.writeIsoLetters(o.consentLanguage); // ConsentLanguage (12 bits)
  w.writeNumber(o.vendorListVersion, 12); // VendorListVersion
  w.writeNumber(TCF_POLICY_VERSION, 6); // TcfPolicyVersion (4 voor v2.2)
  w.writeBool(false); // IsServiceSpecific — false = global scope
  w.writeBool(false); // UseNonStandardStacks — geen alternatieve stacks
  w.writeNumber(0, 12); // SpecialFeatureOptIns: 12 bits, all 0
  w.writeNumber(0, 24); // PurposesConsent: 24 bits, all 0
  w.writeNumber(0, 24); // PurposesLITransparency: 24 bits, all 0
  w.writeBool(false); // PurposeOneTreatment — geen speciale behandeling
  w.writeIsoLetters(o.publisherCC); // PublisherCC (12 bits)

  // --- VendorConsents section ---
  // RangeEncoding met MaxVendorId=1000 en NumEntries=0 betekent:
  // "ik weet van vendors 1..1000, geen enkele heeft consent". Dat is
  // een geldige no-consent representatie die strenge CMPs (Didomi,
  // OneTrust v2.2+) accepteren — in tegenstelling tot MaxVendorId=0
  // wat ze als "ongeldige string" verwerpen.
  //
  // 16 + 1 + 12 = 29 bits totaal. Range-encoding is hier efficiënter
  // dan een 1000-bit BitField van nullen.
  w.writeNumber(VENDOR_MAX_ID, 16); // MaxVendorId
  w.writeBool(true); // IsRangeEncoding = true
  w.writeNumber(0, 12); // NumEntries = 0 → geen consent voor enige vendor

  // --- VendorLegitimateInterests section ---
  // Zelfde structuur — geen LI-acknowledgement voor enige vendor.
  w.writeNumber(VENDOR_MAX_ID, 16);
  w.writeBool(true);
  w.writeNumber(0, 12);

  // --- PublisherRestrictions section ---
  // 12-bit NumPubRestrictions = 0, gevolgd door geen entries.
  w.writeNumber(0, 12);

  return w.toBase64Url();
}
