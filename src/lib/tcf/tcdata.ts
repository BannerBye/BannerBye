/**
 * TCData object voor IAB CMP API v2.2.
 *
 * Dit is het object dat sites krijgen wanneer ze
 * `__tcfapi('getTCData', 2, callback)` aanroepen. Het bevat de
 * geëncodeerde TC-string + alle losse velden in object-vorm
 * (handiger voor JS-consumenten dan zelf te decoderen).
 *
 * Voor BannerBye: alle consents en LIs zijn `false`, alle vendor-
 * objecten zijn leeg. Het TCData-object is consistent met de
 * TC-string die we genereren — iemand die beide decodeert ziet
 * exact hetzelfde "no consent" beeld.
 *
 * Spec:
 *   https://github.com/InteractiveAdvertisingBureau/GDPR-Transparency-and-Consent-Framework/blob/master/TCFv2/IAB%20Tech%20Lab%20-%20CMP%20API%20v2.md
 */

import { generateNoConsentString, type TCStringOptions } from './tcstring.ts';

/** TCF v2.2 heeft 11 actieve purposes (purpose 12 is deprecated). */
const TCF_PURPOSE_COUNT = 11;

/** TCF v2.2 heeft 2 special features: 1=geolocation, 2=device scan. */
const TCF_SPECIAL_FEATURE_COUNT = 2;

/**
 * Volledige shape van het TCData-object zoals gespecificeerd in
 * de IAB CMP API v2.2. Alle velden zijn verplicht — sites mogen
 * elk veld uitlezen zonder existence-check.
 */
export interface TCData {
  tcString: string;
  tcfPolicyVersion: number;
  cmpId: number;
  cmpVersion: number;
  cmpStatus: 'loaded' | 'loading' | 'error' | 'stub';
  eventStatus: 'tcloaded' | 'cmpuishown' | 'useractioncomplete';
  /** Aanwezig na addEventListener; matched de id die we teruggaven. */
  listenerId?: number;
  isServiceSpecific: boolean;
  useNonStandardStacks: boolean;
  publisherCC: string;
  purposeOneTreatment: boolean;
  gdprApplies: boolean;
  outOfBand: {
    allowedVendors: Record<string, boolean>;
    disclosedVendors: Record<string, boolean>;
  };
  purpose: {
    consents: Record<string, boolean>;
    legitimateInterests: Record<string, boolean>;
  };
  vendor: {
    consents: Record<string, boolean>;
    legitimateInterests: Record<string, boolean>;
  };
  specialFeatureOptins: Record<string, boolean>;
  publisher: {
    consents: Record<string, boolean>;
    legitimateInterests: Record<string, boolean>;
    customPurpose: {
      consents: Record<string, boolean>;
      legitimateInterests: Record<string, boolean>;
    };
    restrictions: Record<string, never>;
  };
}

/**
 * Bouwt een complete no-consent TCData inclusief bijbehorende TC-string.
 *
 * Het object en de string zijn semantisch identiek: beide zeggen
 * "user weigert alle consents en LIs voor alle purposes en vendors".
 */
export function buildNoConsentTCData(opts: TCStringOptions = {}): TCData {
  const tcString = generateNoConsentString(opts);
  const purposes = buildAllFalse(TCF_PURPOSE_COUNT);
  const features = buildAllFalse(TCF_SPECIAL_FEATURE_COUNT);

  return {
    tcString,
    tcfPolicyVersion: 5,
    cmpId: opts.cmpId ?? 0,
    cmpVersion: opts.cmpVersion ?? 1,
    cmpStatus: 'loaded',
    // 'useractioncomplete' = user heeft expliciet beslist, signaal is finaal.
    // Strenge CMPs (Didomi) tonen anders alsnog hun UI om "expliciete actie"
    // af te dwingen, ook al ligt er een geldige consent-string klaar.
    eventStatus: 'useractioncomplete',
    isServiceSpecific: false,
    useNonStandardStacks: false,
    publisherCC: opts.publisherCC ?? 'AA',
    purposeOneTreatment: false,
    gdprApplies: true,
    outOfBand: { allowedVendors: {}, disclosedVendors: {} },
    purpose: {
      consents: { ...purposes },
      legitimateInterests: { ...purposes },
    },
    vendor: {
      consents: {},
      legitimateInterests: {},
    },
    specialFeatureOptins: features,
    publisher: {
      consents: { ...purposes },
      legitimateInterests: { ...purposes },
      customPurpose: { consents: {}, legitimateInterests: {} },
      restrictions: {},
    },
  };
}

/** Helper: object van string-keys "1".."N" naar `false`. */
function buildAllFalse(count: number): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (let i = 1; i <= count; i++) {
    result[String(i)] = false;
  }
  return result;
}
