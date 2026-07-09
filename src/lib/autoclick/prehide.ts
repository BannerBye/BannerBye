/**
 * Prehide — flikkervrij weigeren (techniek geleend van DuckDuckGo Autoconsent).
 *
 * Idee: verberg de bekende cookie-banner-containers al op document_start
 * (vóór ze schilderen), laat de autoclick-laag ze op de achtergrond weigeren,
 * en toon ze daarna óf niet meer (gelukt) óf alsnog (mislukt). Zo wordt ook de
 * reactieve autoclick-laag écht "before they load" i.p.v. 100–500 ms flikker.
 *
 * ETHOS: dit verbergt alleen *tijdens* het actief weigeren, met een harde
 * safety-timeout die de banner weer toont als weigeren niet lukt. Het is dus
 * géén stille verberging van onweigerbare cookie-walls.
 *
 * Waarom `opacity: 0` en niet `display: none`? Bij display:none is het element
 * niet meer betrouwbaar te vinden/klikken door de autoclick-laag. Met opacity:0
 * (+ pointer-events:none) is de banner onzichtbaar en klikt de gebruiker door
 * naar de pagina, maar blijft de weiger-knop vindbaar en programmatisch
 * klikbaar (element.click() negeert pointer-events).
 */

/**
 * SPECIFIEKE CMP-container-selectors. Bewust krap gehouden (echte CMP-roots,
 * geen brede `[class*=cookie]`-patronen) om false positives te voorkomen. De
 * safety-reveal vangt een eventuele misser sowieso binnen enkele seconden op.
 */
export const PREHIDE_SELECTORS: string[] = [
  // OneTrust
  '#onetrust-banner-sdk',
  '#onetrust-consent-sdk',
  // Cookiebot
  '#CybotCookiebotDialog',
  '#CybotCookiebotDialogBodyUnderlay',
  // Usercentrics
  '#usercentrics-root',
  '#usercentrics-cmp-ui',
  '[data-testid="uc-container"]',
  // Didomi
  '#didomi-host',
  // Quantcast
  '.qc-cmp2-container',
  '#qc-cmp2-container',
  // Sourcepoint (message container in de hoofd-DOM houdt de iframe vast)
  '[id^="sp_message_container"]',
  // TrustArc
  '#truste-consent-track',
  '.truste_overlay',
  // Osano / Cookie Consent (Insites)
  '.osano-cm-window',
  '.cc-window',
  // Klaro
  '.klaro .cookie-modal',
  // CookieScript
  '#cookiescript_injected',
  // Complianz / CookieYes
  '#cookie-law-info-bar',
  '.cky-consent-container',
  // consentmanager
  '#cmpbox',
  '#cmpwrapper',
  // Termly
  '#termly-code-snippet-support',
  // Veelvoorkomende, redelijk specifieke banner-ID's
  '#cookie-notice',
  '#cookieConsent',
  '#cookie-consent-banner',
];

const STYLE_ID = 'bb-prehide-style';

/** Injecteer de prehide-CSS. Idempotent; veilig op document_start. */
export function injectPrehide(): void {
  try {
    if (document.getElementById(STYLE_ID)) return;
    const css =
      PREHIDE_SELECTORS.join(',\n') +
      ' { opacity: 0 !important; pointer-events: none !important;' +
      ' transition: none !important; animation: none !important; }';
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = css;
    // documentElement bestaat gegarandeerd op document_start; head mogelijk niet.
    (document.head || document.documentElement).appendChild(style);
  } catch {
    // Nooit de pagina laten breken door de prehide zelf.
  }
}

/** Verwijder de prehide-CSS → banners worden weer zichtbaar. */
export function revealPrehide(): void {
  try {
    document.getElementById(STYLE_ID)?.remove();
  } catch {
    // niet kritiek
  }
}
