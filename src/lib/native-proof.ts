/**
 * BannerBye — bewijs naar de Apple host-app (v0.4.8, bouwpunt 6 uit het
 * productonderzoek van 5 oktober 2026).
 *
 * Op iPhone, iPad en Mac zit BannerBye in een host-app die de gebruiker
 * ziet bij installatie. Die app kon tot nu toe niet weten óf de extensie
 * aanstaat, laat staan of hij iets doet. Sinds Safari 26.2 kan de app de
 * aan/uit-stand opvragen (SFSafariExtensionManager); dit bestand doet het
 * tweede deel: na elke geweigerde banner stuurt de extensie één berichtje
 * naar de host-app via `runtime.sendNativeMessage`. De app bewaart dat in
 * de gedeelde App Group en toont "Works — first banner refused on nu.nl".
 *
 * Wat hier NIET gebeurt: niets verlaat het toestel. Het bericht gaat van
 * het extensieproces naar het app-proces op hetzelfde apparaat, zonder
 * netwerk. Op Chrome, Firefox en Edge bestaat deze route niet en doet de
 * functie niets (geen `nativeMessaging`-permissie in die manifests).
 */

export interface ProofMessage {
  type: 'proof';
  /** Cumulatief aantal geweigerde banners op dit apparaat. */
  blocked: number;
  /** Host van de laatste weigering, of null (bv. bij de boot-sync). */
  host: string | null;
  /** Tijdstip (ms sinds epoch). */
  at: number;
  /** Extensieversie, zodat de app kan tonen welke versie er draait. */
  version: string;
}

const IS_SAFARI =
  (import.meta as unknown as { env: { BROWSER: string } }).env.BROWSER === 'safari';

/**
 * Stuur het bewijs naar de host-app. Best-effort: elke fout wordt stil
 * genegeerd, want de teller en de badge mogen hier nooit onder lijden.
 */
export function sendProofToHostApp(blocked: number, host: string | null): void {
  if (!IS_SAFARI) return;
  try {
    const runtime = chrome.runtime as unknown as {
      sendNativeMessage?: (
        app: string,
        message: unknown,
        cb?: (response: unknown) => void,
      ) => void;
      getManifest: () => { version: string };
    };
    if (typeof runtime.sendNativeMessage !== 'function') return;
    const message: ProofMessage = {
      type: 'proof',
      blocked,
      host,
      at: Date.now(),
      version: runtime.getManifest().version,
    };
    // Safari negeert het eerste argument (de app-id) maar vereist een string.
    runtime.sendNativeMessage('application.id', message, () => {
      // Antwoord is niet interessant; lastError wel lezen, anders logt Safari
      // een "Unchecked runtime.lastError"-waarschuwing.
      void chrome.runtime.lastError;
    });
  } catch {
    // Geen native host (bv. oude Safari of extensie buiten de app) — prima.
  }
}
