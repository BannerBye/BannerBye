/**
 * Schema voor de remote rule-set die we hosten op
 *   https://bannerbye.com/rules.json
 *
 * De extensie fetcht dit bestand één keer per dag in de background,
 * cachet 'm in chrome.storage.local, en gebruikt 'm naast de gebundelde
 * keyword-lijsten. Zo kunnen we nieuwe sites/varianten ondersteunen
 * zonder een Chrome Web Store-release te triggeren (review-tijd is
 * dagen tot weken).
 *
 * Backwards-compat: de extensie moet draaien zonder remote rules,
 * en moet onbekende velden negeren. Daarom zijn alle velden optional.
 *
 * Versie-veld: ophogen bij breaking schema-changes. De extensie kan
 * dan oudere versies negeren of een fallback gebruiken.
 */

export interface RemoteRules {
  /** Schema-versie. Begin bij 1, hoog op bij breaking changes. */
  version: number;

  /** ISO-timestamp wanneer dit bestand is gepubliceerd. */
  updatedAt?: string;

  /** Aanvullingen op de gebundelde autoclick-keyword-lijsten. */
  autoclick?: {
    /** Extra exact-match weiger-keywords (PASS 1). */
    rejectKeywords?: string[];
    /** Extra ambigue keywords die alleen in cookie-context matchen (PASS 2). */
    ambiguousKeywords?: string[];
    /** Extra step-into keywords ("Meer opties"-varianten, PASS 3). */
    stepIntoKeywords?: string[];
    /**
     * Extra zin-fragmenten voor PASS 1.5 (substring-match binnen een
     * knoptekst, alleen in cookie-banner-context). Zie REJECT_PHRASES.
     */
    rejectPhrases?: string[];
  };

  /**
   * Hosts met een consent-or-pay-muur (het "PUR"-model): geen gratis
   * weigeroptie, alleen accepteren of betalen. BannerBye laat die met rust
   * en legt in de popup uit waarom. Zie `src/lib/consent-or-pay.ts`.
   *
   * Alleen toevoegen na verificatie dat er écht geen gratis weigerknop is —
   * een host hier onterecht in zetten laat een site los die we wél aankonden.
   */
  consentOrPay?: string[];
}
