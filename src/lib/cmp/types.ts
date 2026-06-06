/**
 * Architectuur voor CMP-specifieke handlers.
 *
 * Een CMP (Consent Management Platform) is de software die op de
 * publisher-site cookie-banners toont en consent-state beheert.
 * Onze TCF-stub vangt de standaard-route af, maar sommige CMPs
 * (Didomi, OneTrust in oudere config, etc.) hebben proprietaire
 * cookies/APIs nodig om hun banner te skippen.
 *
 * Per CMP schrijven we één handler die:
 *  - detecteert of de CMP op deze pagina draait
 *  - "no consent" toepast via de juiste API of cookie
 *
 * Handlers worden opgesomd in `cmp/index.ts` en uitgevoerd door
 * het `cmp.content.ts` entrypoint in MAIN world (zo kunnen we
 * direct met de page-context praten waar de CMPs in leven).
 */

export interface CmpHandler {
  /** Unieke naam (bijv. "didomi", "onetrust"). Voor logging + debug. */
  readonly name: string;

  /**
   * Returns true als deze CMP op de huidige pagina aanwezig is.
   * Moet snel zijn — we callen 'm voor elke handler op elke page-load.
   * Mag false-positief zijn (we proberen de apply, faalt stil als CMP
   * niet echt aanwezig is).
   */
  detect(): boolean;

  /**
   * Pas "no consent" toe. Mag asynchroon zijn (bv. wachten tot CMP
   * SDK klaar is met laden). Moet stil falen — fouten loggen we
   * maar laten we niet doorpropageren.
   */
  apply(): Promise<void>;
}
