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
 * Historie: uit sinds de bouw (juli 2026); uit-advies bevestigd 2026-08-21
 * (testronde) en 2026-09-06 (heise.de-incident, #204). Op 2026-09-07 (#170)
 * bleek dat de laag sowieso nooit gewerkt kón hebben (constructor-crash in de
 * vendored library, gefixt in autoconsent-layer.ts) én dat de "successen" van
 * laag 2 op Sourcepoint-sites in werkelijkheid CMP-crashes waren op onze
 * niet-schrijfbare `__tcfapi` (zie tcf.content.ts). Die crash is dezelfde dag
 * gefixt — en daarmee is deze laag geen optie meer maar een noodzaak: zodra
 * Sourcepoint's wrapper niet meer crasht rendert de banner in een
 * cross-origin iframe, en alleen deze laag kan daar wegklikken.
 *
 * AAN sinds 2026-09-07 in de code. Nog niet uitgebracht — de release-beslissing
 * blijft aan Robin (zie BannerBye_Autoconsent-Besluit_v1.md en het
 * release-sync-protocol in SKILL.md §2).
 */
export const AUTOCONSENT_LAYER_ENABLED = true;

/**
 * Hosts waarop de Autoconsent-laag NIET draait (suffix-match op de hostnaam).
 *
 * v0.4.2 (#170/#212, 7 sep 2026): met de laag aan bleef Google Sheets in
 * Robins Chrome ruim een minuut onbereikbaar voor scriptinjectie
 * (`document_idle` werd niet gehaald), terwijl dezelfde pagina met de laag
 * uit binnen zes seconden klaar was. De exacte oorzaak was in de sandbox niet
 * te reproduceren (een ingelogde Sheets-editor is daar niet beschikbaar; een
 * publiek sheet en een synthetische 48k-node-pagina bleven responsief). Deze
 * lijst is daarom een bewuste rem, in dezelfde geest als de Exact
 * Online-uitsluiting in de content-scripts: op de app-oppervlakken van deze
 * productiviteitstools verschijnt nooit een cookie-banner van derden — Google
 * en Microsoft regelen consent op aparte pagina's (consent.google.com, de
 * login-flow) — dus een 800-regels-motor heeft er niets te zoeken en kan er
 * alleen maar kosten. De overige lagen (GPC, TCF, CMP-handlers, generieke
 * auto-click) blijven op deze hosts gewoon actief.
 */
export const AUTOCONSENT_EXCLUDED_HOST_SUFFIXES: string[] = [
  // Google Workspace-apps (docs/sheets/slides/forms leven allemaal op docs.google.com)
  'docs.google.com',
  'drive.google.com',
  'mail.google.com',
  'calendar.google.com',
  'meet.google.com',
  'keep.google.com',
  'chat.google.com',
  'contacts.google.com',
  // Microsoft 365 / Outlook / Teams / OneDrive
  'office.com',
  'office365.com',
  'microsoft365.com',
  'live.com',
  'sharepoint.com',
  'onedrive.com',
  'teams.microsoft.com',
  'outlook.office.com',
  // Andere zware web-apps zonder cookie-banner op het app-oppervlak
  'figma.com',
  'notion.so',
  'app.slack.com',
  'miro.com',
  'canva.com',
  'web.whatsapp.com',
];

/** Valt deze hostnaam onder AUTOCONSENT_EXCLUDED_HOST_SUFFIXES? */
export function isAutoconsentExcludedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return AUTOCONSENT_EXCLUDED_HOST_SUFFIXES.some((s) => h === s || h.endsWith('.' + s));
}

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
