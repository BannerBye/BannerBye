/**
 * Gedeelde feature-flags.
 *
 * Centraal zodat andere lagen (bijvoorbeeld prehide) hun gedrag op dezelfde
 * vlag kunnen afstemmen, zonder een losse, uit-sync-rakende eigen constante
 * bij te houden — precies dat gebeurde bij het heise.de-incident (zie
 * IFRAME_ONLY_CMP_SELECTORS hieronder).
 */

/**
 * Autoconsent-laag (Fase 1, iframe-bewust) — zie entrypoints/autoconsent.content.ts.
 *
 * ⚠️ STAAT UIT. Vastgesteld 2026-08-21 (testronde), opnieuw bevestigd
 * 2026-09-06 na het heise.de-incident (zie taak #204 / SKILL.md §11). Zet pas
 * op `true` ná een échte browsertest op Sourcepoint-sites — bild.de,
 * spiegel.de, theguardian.com, heise.de zijn de bekende testkandidaten
 * (allemaal Sourcepoint met cross-origin iframe-UI). Zie taak #170.
 */
export const AUTOCONSENT_LAYER_ENABLED = false;

/**
 * CMP-containers die UITSLUITEND via een (vrijwel altijd cross-origin)
 * iframe klikbaar zijn — de daadwerkelijke knoppen (accept/reject) leven in
 * dat iframe-document, niet in de hoofd-DOM.
 *
 * De generieke auto-click-laag (autoclick.content.ts) kan zulke iframes
 * principieel niet bereiken: content scripts draaien daar niet in
 * (allFrames: false, bewust — zie het bestand zelf), en zelfs de
 * DOM-walker's `frame.contentDocument`-poging gooit bij cross-origin.
 * Alleen de Autoconsent-laag (allFrames: true + frame-guard) kan zulke
 * banners daadwerkelijk wegklikken.
 *
 * Gevolg: prehide mag zo'n container alléén verbergen als er ook een laag
 * actief is die 'm kan wegklikken. Zonder die laag verdwijnt de banner na
 * het verbergen gegarandeerd nooit — na REVEAL_FALLBACK_MS (3,5s) komt hij
 * altijd weer terug. Op een site met veel paginanavigaties (elke
 * nieuwsartikel = nieuwe load) herhaalt die 3,5s hide→reveal-cyclus zich bij
 * elke paginalaad, wat als aanhoudend knipperen aanvoelt — precies wat Robin
 * meldde bij heise.de (2026-09-06, taak #204). Zolang AUTOCONSENT_LAYER_ENABLED
 * false is, laat prehide deze containers dus met rust: geen ingreep is
 * beter dan een ingreep die nooit voltooid kan worden.
 */
export const IFRAME_ONLY_CMP_SELECTORS: string[] = [
  // Sourcepoint — message-container in de hoofd-DOM houdt alleen de iframe
  // vast; de knoppen (.sp_choice_type_11/12/13/...) zitten in dat iframe.
  '[id^="sp_message_container"]',
];
