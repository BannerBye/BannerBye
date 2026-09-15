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

/**
 * Eén set keyword-aanvullingen — hetzelfde veldenschema wordt gebruikt voor
 * de globale (site-onafhankelijke) aanvullingen én voor host-scoped regels
 * (zie `hostRules` hieronder).
 */
export interface RemoteAutoclickFields {
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
  /**
   * Extra cookie-context-woorden (lokale taal voor "cookie"/"privacy"/
   * "toestemming" e.d.) — gebruikt door isInCookieBanner()/PASS 2.
   */
  contextWords?: string[];
  /**
   * Extra taalonafhankelijke id/class/data-*-hints, losse tokens
   * (PASS ATTR, WORD-tier). Zie ATTRIBUTE_REJECT_WORD_HINTS in keywords.ts.
   */
  attributeWordHints?: string[];
  /**
   * Extra taalonafhankelijke id/class/data-*-hints, samengestelde
   * substrings (PASS ATTR, COMPACT-tier). Zie ATTRIBUTE_REJECT_COMPACT_HINTS.
   */
  attributeCompactHints?: string[];
}

export interface RemoteRules {
  /** Schema-versie. Begin bij 1, hoog op bij breaking changes. */
  version: number;

  /** ISO-timestamp wanneer dit bestand is gepubliceerd. */
  updatedAt?: string;

  /**
   * Aanvullingen op de gebundelde autoclick-keyword-lijsten.
   *
   * v0.4.4 (sep 2026): dit is nu het primaire kanaal om een nieuwe taal te
   * dekken zonder store-release — zie de toelichting bovenaan keywords.ts.
   * Bij een gebruikersmelding over een taal die hier nog niet in zit: voeg
   * de keywords toe aan dit bestand (accented + unaccented waar relevant,
   * zie de Griekse §11-les in de skill) i.p.v. een extensie-versie te bouwen.
   */
  autoclick?: RemoteAutoclickFields & {
    /**
     * v0.4.5 (fix #3, security-audit 2026-09-16) — host-scoped aanvullingen.
     * Sleutel = hostname (bv. `"coffeeisland.gr"`), case-insensitive. Een
     * regel geldt voor die hostname zelf ÉN elk subdomein ervan (een regel
     * op `"example.com"` geldt dus ook voor `"www.example.com"`, niet
     * andersom) — zie `isHostRuleMatch()` in keywords.ts voor de matcher.
     *
     * Bedoeld voor de minst geverifieerde voorstellen — met name output van
     * de taalgat-generator (Phase 2B/2C) — zodat een fout keyword niet
     * meteen wereldwijd op elke site matcht: de blast radius blijft beperkt
     * tot de ene host waar het voorstel vandaan kwam. De handmatig
     * gecureerde, taal-brede lijsten blijven gewoon in de globale velden
     * hierboven staan.
     */
    hostRules?: Record<string, RemoteAutoclickFields>;
  };
}
