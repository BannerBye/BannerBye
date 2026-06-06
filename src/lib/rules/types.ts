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
  };
}
