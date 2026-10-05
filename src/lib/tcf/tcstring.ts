/**
 * IAB TCF v2 TC-string generator (v2.2-formaat, v2.3-beleid).
 *
 * BannerBye stuurt naar elke pagina dezelfde "no-consent"-string:
 *  - Geen consent voor enige purpose (1..24)
 *  - Geen opt-in op enige special feature (1..12)
 *  - Geen vendor-consent (range-encoding, MaxVendorId=1000, 0 entries)
 *  - Geen vendor legitimate interest acknowledgement
 *  - Geen publisher restrictions
 *  - Service-specifiek (global scope is sinds sept 2021 niet toegestaan)
 *  - Een DisclosedVendors-segment zonder vendors (verplicht sinds v2.3
 *    voor strings aangemaakt na 28 februari 2026)
 *
 * De string wordt aan sites geserveerd via `__tcfapi` en als
 * `euconsent-v2`-cookie. Het IAB Europe Transparency & Consent
 * Framework verplicht CMP-compatible sites om dit signal te respecteren.
 *
 * Format-spec:
 *   https://github.com/InteractiveAdvertisingBureau/GDPR-Transparency-and-Consent-Framework/blob/master/TCFv2/IAB%20Tech%20Lab%20-%20Consent%20string%20and%20vendor%20list%20formats%20v2.md
 *
 * Validatie: `pnpm tcf:verify` decodeert de string met de officiële
 * IAB Tech Lab-bibliotheek (`@iabtechlabtcf/core`) en controleert elk
 * veld. Handmatig: https://iabtcf.com/#/decode — alle velden moeten
 * gelezen kunnen worden zonder errors.
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
export const TCF_POLICY_VERSION = 5;

/**
 * Realistische MaxVendorId voor de vendor-secties.
 * De echte IAB GVL bevat ~360+ vendors. Met 0 zegt onze string
 * "ik weet van geen enkele vendor", wat strenge CMPs verwerpen.
 * 1000 is een veilige bovengrens — alle vendors die de GVL ooit
 * heeft gehad passen hierbinnen.
 */
const VENDOR_MAX_ID = 1000;

/**
 * Segment-type van het DisclosedVendors-segment (3 bits aan het begin van
 * elk niet-core-segment). 0 = core (impliciet), 1 = DisclosedVendors,
 * 2 = AllowedVendors (vervallen), 3 = PublisherTC.
 */
const SEGMENT_TYPE_DISCLOSED_VENDORS = 1;

/**
 * Sentinel-CMP-ID voor een niet bij IAB geregistreerde agent (v0.4.8).
 *
 * Waarom niet 0: de IAB Tech Lab-referentiedecoder (`@iabtechlabtcf/core`
 * 1.5.22) weigert élke string met cmpId 0 of 1 — `invalid value 0 passed
 * for cmpId` — en elke CMP of vendor die op die bibliotheek leunt, gooide
 * onze string dus weg vóór hij één bit had gelezen (gemeten 5 okt 2026).
 * 4095 is het maximum van het 12-bits veld, ligt ver boven de toegekende
 * reeks (~450 op 5 okt 2026) en is daarmee ondubbelzinnig "geen
 * geregistreerde CMP" zonder iemands ID te lenen. Registratie bij IAB
 * Europe (https://iabeurope.eu/cmp-list/) blijft een losse beslissing;
 * dan vervangt het toegekende nummer deze sentinel.
 */
export const UNREGISTERED_CMP_ID = 4095;

export interface TCStringOptions {
  /**
   * CMP ID toegekend door IAB Europe. Standaard UNREGISTERED_CMP_ID (zie
   * daar). Waarden 0 en 1 worden door de referentiedecoder geweigerd en
   * zijn dus geen geldige keuze.
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
  cmpId: UNREGISTERED_CMP_ID,
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
 * Genereert een TCF v2 "no-consent" TC-string: Core segment plus het
 * DisclosedVendors-segment, met een punt ertussen.
 *
 * Het DisclosedVendors-segment was tot v2.2 optioneel; sinds v2.3 is het
 * verplicht voor service-specifieke strings die na 28 februari 2026 zijn
 * gemaakt. AllowedVendors (vervallen) en PublisherTC laten we weg — die
 * zijn niet relevant voor "weiger alles".
 *
 * @returns twee base64url-segmenten zonder padding, gescheiden door een
 *          punt (~56 chars).
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
  w.writeNumber(TCF_POLICY_VERSION, 6); // TcfPolicyVersion
  // IsServiceSpecific — true = de string geldt alleen voor deze site.
  // Global scope (false) is sinds september 2021 niet meer toegestaan in
  // TCF v2; decoders die daarop controleren gooien zo'n string weg.
  w.writeBool(true);
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

  const core = w.toBase64Url();

  // === DISCLOSED VENDORS SEGMENT ===
  // Verplicht voor service-specifieke strings die na 28 februari 2026 zijn
  // aangemaakt (TCF v2.3-beleid, IAB Europe). Het segment zegt welke
  // vendors aan de gebruiker zijn getoond; wij tonen er geen, dus een
  // range-encoding met MaxVendorId=1000 en NumEntries=0 — dezelfde vorm
  // als de vendor-secties hierboven. Segmenten worden met een punt aan
  // elkaar geplakt; elk niet-core-segment begint met 3 bits SegmentType.
  const d = new BitWriter();
  d.writeNumber(SEGMENT_TYPE_DISCLOSED_VENDORS, 3); // SegmentType
  d.writeNumber(VENDOR_MAX_ID, 16); // MaxVendorId
  d.writeBool(true); // IsRangeEncoding
  d.writeNumber(0, 12); // NumEntries = 0 → geen vendor gedisclosed

  return `${core}.${d.toBase64Url()}`;
}
