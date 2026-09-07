/**
 * Autoconsent-laag (concurrentie-pariteit — Fase 1).
 *
 * Draait de DuckDuckGo Autoconsent-engine (MPL-2.0) met 776 declaratieve
 * CMP-regels als extra laag tussen TCF en de generieke auto-click. Handelt
 * bekende Consent Management Providers deterministisch af met meerstaps
 * opt-out + eigen prehide + self-test.
 *
 * ⚠️ NB: deze laag draait op elke pagina en coördineert async met de generieke
 * auto-click. Aan/uit en host-uitsluitingen: AUTOCONSENT_LAYER_ENABLED en
 * AUTOCONSENT_EXCLUDED_HOST_SUFFIXES in feature-flags.ts.
 *
 * Coördinatie met de generieke auto-click gebeurt via twee vlaggen op de
 * gedeelde ISOLATED-world `window`:
 *   __bbConsentActive  — een bekende CMP wordt nu verwerkt → autoclick wacht
 *   __bbConsentHandled — CMP is afgehandeld → autoclick slaat over
 *
 * Eval-acties (~5% van de regels, o.a. Usercentrics, Cookiebot en
 * consentmanager): sinds v0.4.2 (#170) beantwoord via een MAIN-world-brug in
 * de background (`bb:autoconsent-eval` → `chrome.scripting.executeScript`
 * met `world: 'MAIN'` en het DDG-snippet als `func`, precies zoals DDG's
 * eigen MV3-extensie het doet). Waar die brug niet bestaat (oudere Firefox/
 * Safari zonder MAIN-world-executeScript) vallen we terug op een DOM-shim
 * (zie EVAL_DOM_SHIMS) en anders op `false`, wat netjes degradeert.
 *
 * ⚠️ Het eval-antwoord MOET asynchroon terug (zie de `eval`-case hieronder).
 * De library stuurt eerst het eval-bericht en registreert pas dáárna de
 * pending Deferred; een synchroon antwoord ("no eval #…") gaat verloren en
 * elke eval liep dan in z'n 1 s-timeout. Dat kostte per detectieronde ≥1 s
 * (Cookiebot-/consentmanager-evals staan in vrijwel elke ronde) én liet de
 * Usercentrics-regel nooit bij z'n klikstap komen — de reden dat zalando.nl
 * z'n banner hield. Ontdekt 7 sep 2026 met een replica-pagina in de sandbox.
 *
 * v0.3.5-nuance: voor een handvol bekende eval-snippets beantwoorden we de
 * vraag desnoods zonder brug — niet door page-JS te draaien, maar met een
 * DOM-check die in ISOLATED world gewoon kan (document is gedeeld).
 * Voorbeeld: de `usercentrics-api`-regel opent z'n popup-detectie met
 * `typeof UC_UI === "object"`; de aanwezigheid van de UC-container in de DOM
 * vertelt hetzelfde. Zie EVAL_DOM_SHIMS.
 */

import AutoConsent from '@duckduckgo/autoconsent';
import type { Config, RuleBundle } from '@duckduckgo/autoconsent';
import rules from '@duckduckgo/autoconsent/rules/rules.json';

declare global {
  interface Window {
    __bbConsentActive?: boolean;
    __bbConsentHandled?: boolean;
    /**
     * v0.4.2 (#170): laag 5 mag in dit frame niet "doorklikken" naar een
     * instellingenpaneel. Gezet in Sourcepoint-frames: de motor opent en
     * beoordeelt de privacy-manager zelf; een tweede "Einstellingen"-klik
     * van laag 5 zou 'm opnieuw openen nadat de motor 'm net heeft
     * teruggedraaid (consent-of-betaal-sites, zie SOURCEPOINT_VERIFY_MS).
     */
    __bbStepIntoBlocked?: boolean;
  }
}

/**
 * DOM-gebaseerde antwoorden voor bekende eval-snippets. Alleen toevoegen
 * als de vraag betrouwbaar uit de gedeelde DOM af te leiden is — bij twijfel
 * niet shimen (false is de veilige default).
 *
 * EVAL_USERCENTRICS_API_0 vraagt `typeof UC_UI === "object"` (is de
 * Usercentrics-API er?). De v3 Web CMP definieert UC_UI überhaupt niet meer,
 * dus de eigenlijke vraag is "is Usercentrics hier actief" — en dat zegt de
 * aanwezigheid van de containers net zo goed. De regelstappen erna zijn purely
 * DOM (waitForVisible + click op de deny-knop).
 */
const EVAL_DOM_SHIMS: Record<string, () => boolean> = {
  EVAL_USERCENTRICS_API_0: () =>
    !!document.querySelector('#usercentrics-cmp-ui, #usercentrics-root'),
};

/**
 * Eigen declaratieve regels bovenop de gebundelde Autoconsent-regelset.
 *
 * Zelfde syntaxis als `rules.json` (array-selectors = querySelectorChain,
 * dus dwars door een shadow root heen). Alleen voor gevallen waar de
 * gebundelde regel aantoonbaar achterloopt op de werkelijkheid — en dan met
 * een eigen naam, zodat een latere library-update nooit stilzwijgend botst.
 *
 * v0.4.2 (#170, 7 sep 2026) — DPG Media (nu.nl, ad.nl, volkskrant.nl,
 * parool.nl, trouw.nl, hln.be, demorgen.be, …): de gebundelde regel
 * `dpgmedia-nl` zoekt de shadow-host `#pg-root-shadow-host`, maar DPG's
 * privacy-gate heet inmiddels `#pg-shadow-host-dom`. Daardoor bleef op nu.nl
 * de muur ("Inloggen / Akkoord / Instellen") staan, mét een scroll-lock op
 * <body>. De knoppen erin zijn ongewijzigd: eerste laag `#pg-configure-btn`
 * ("Instellen"), tweede laag `#pg-reject-btn` ("Alles weigeren") — in Robins
 * Chrome handmatig geverifieerd: DPG slaat de weigering op
 * (`dpg-consent-string`), herlaadt één keer en de gate blijft weg.
 * Dit is géén accept-or-pay-muur (er is een gratis weigerpad), dus weigeren
 * is precies wat BannerBye hoort te doen.
 */
const BANNERBYE_EXTRA_RULES = [
  {
    name: 'bannerbye-dpgmedia-nl',
    prehideSelectors: ['#pg-shadow-host-dom'],
    detectCmp: [{ exists: '#pg-shadow-host-dom' }],
    detectPopup: [{ visible: ['#pg-shadow-host-dom', '#pg-modal'] }],
    optIn: [{ waitForThenClick: ['#pg-shadow-host-dom', '#pg-accept-btn'] }],
    optOut: [
      { waitForThenClick: ['#pg-shadow-host-dom', '#pg-configure-btn'] },
      { waitForThenClick: ['#pg-shadow-host-dom', '#pg-reject-btn'] },
    ],
  },
];

/**
 * Antwoord op een eval-verzoek van de motor.
 *
 * 1. MAIN-world-brug via de background (Chrome MV3; Firefox ≥ 128 met de
 *    scripting-API). De background antwoordt `{ ok: true, result }` als het
 *    snippet daadwerkelijk in de pagina-context is uitgevoerd.
 * 2. Anders een DOM-shim, als die bestaat voor dit snippet.
 * 3. Anders `false` — de regel neemt z'n else-tak of slaat de stap over.
 *
 * Altijd async (ook de shim-route), zie de kanttekening in de kop.
 */
async function evaluateSnippet(snippetId: string | undefined): Promise<boolean> {
  if (!snippetId) return false;

  try {
    const response: unknown = await Promise.resolve(
      chrome.runtime.sendMessage({ type: 'bb:autoconsent-eval', snippetId }),
    );
    if (
      response &&
      typeof response === 'object' &&
      (response as { ok?: unknown }).ok === true
    ) {
      return !!(response as { result?: unknown }).result;
    }
  } catch {
    // Geen background bereikbaar (bv. extensie net herladen) → shim/false.
  }

  const shim = EVAL_DOM_SHIMS[snippetId];
  if (shim) {
    try {
      return shim();
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Sourcepoint privacy-manager: verifieer of de opt-out écht is doorgegaan.
 *
 * DDG's Sourcepoint-regel klikt in de eerste laag op "Einstellungen" als er
 * geen weigerknop is, en in de privacy-manager (eigen iframe) op REJECT_ALL
 * of — als die er niet is — op SAVE_AND_EXIT. Op consent-of-betaal-sites
 * zoals heise.de heeft die manager per doel eigen "Zustimmen/Ablehnen"-
 * knoppen en blijft "Ausgewähltem zustimmen" uitgeschakeld zolang je niet
 * met minstens het eerste doel instemt: er ís geen gratis weigerroute. De
 * library meldt de klik op de dode knop tóch als succes en laat de manager
 * open staan — mét scroll-lock op de pagina. Dat is slechter dan zonder
 * BannerBye. Daarom: 2,5 s na "succes" kijken of de manager nog open is.
 * Zo ja → "Zurück" (`.sp_choice_type_CANCEL`), waarna de site er exact zo
 * bij staat als zonder ons (eerste laag zichtbaar; de keuze blijft aan de
 * gebruiker — ethos: muren blijven zichtbaar). Zo nee (frame weg via
 * `pagehide`, of container verborgen) → pas dán tellen.
 * Sandbox-verificatie 7 sep 2026: na CANCEL toont heise weer
 * "Zustimmen / Einstellungen", één navigatie, geen lus.
 */
const SOURCEPOINT_MANAGER_PATHS = ['/privacy-manager/index.html', '/ccpa_pm/index.html', '/us_pm/index.html'];
const SOURCEPOINT_VERIFY_MS = 2_500;

function isSourcepointManagerFrame(): boolean {
  return window.top !== window && SOURCEPOINT_MANAGER_PATHS.includes(location.pathname);
}

function sourcepointManagerStillOpen(): boolean {
  // Container op display:none → het frame krijgt een viewport van 0×0.
  if (window.innerWidth === 0 || window.innerHeight === 0) return false;
  const control = document.querySelector<HTMLElement>(
    '.sp_choice_type_SAVE_AND_EXIT, .sp_choice_type_REJECT_ALL, .sp_choice_type_CANCEL',
  );
  if (!control) return false;
  const rect = control.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function sourcepointGoBack(): void {
  const cancel = document.querySelector<HTMLElement>('.sp_choice_type_CANCEL');
  try {
    cancel?.click();
  } catch {
    // Niet kritiek — dan blijft de manager staan zoals de library 'm liet.
  }
}

/**
 * Hoe lang de generieke auto-click (laag 5) maximaal wacht op een CMP die
 * de motor wél herkende maar waarvan de popup niet gevonden wordt. De
 * library meldt dat pad niet (geen `autoconsentDone`), dus zonder waakhond
 * bleef `__bbConsentActive` voor altijd staan en deed laag 5 niets meer —
 * ook niet als de banner gewoon zichtbaar op het scherm stond.
 * waitForPopup = 10 pogingen × (500 ms + popup-detectie) ≈ 5–8 s.
 */
const CMP_DETECTED_WATCHDOG_MS = 12_000;

/**
 * Start de Autoconsent-laag. `onHandled` wordt één keer aangeroepen zodra een
 * bekende CMP succesvol is geweigerd (voor de teller + badge).
 */
export function startAutoconsentLayer(onHandled: () => void): void {
  const config: Partial<Config> = {
    enabled: true,
    autoAction: 'optOut',
    // Ethos: géén cosmetisch verbergen via filterlijsten als default.
    enableCosmeticRules: false,
    // Autoconsent doet z'n eigen prehide voor de CMP's die het kent.
    enablePrehide: true,
    isMainWorld: false,
    // Library-default (20 pogingen × ≥ 500 ms ≈ 10 s+ detectievenster).
    // v0.4.2 (#212) had dit tijdelijk op 10 staan om zware pagina's te
    // ontzien, maar de echte last bleek elders te zitten: (a) Google
    // Workspace & co. zijn inmiddels uitgesloten (feature-flags.ts) en de
    // motor wordt alleen nog on-demand geïnjecteerd, (b) elke ronde wachtte
    // ≥ 1 s op eval-timeouts door de sync-antwoordbug (zie kop). Met tien
    // rondes viel een CMP die pas na ~4 s laadt (zalando.nl: Usercentrics-
    // loader op 3,8 s) op een tragere verbinding net buiten het venster.
    detectRetries: 20,
    logs: {
      lifecycle: false,
      rulesteps: false,
      detectionsteps: false,
      evals: false,
      errors: false,
      messages: false,
      waits: false,
    },
  };

  let handledFired = false;
  const markHandled = (): void => {
    if (handledFired) return;
    handledFired = true;
    // v0.4.2 (#170): heeft laag 4 (CMP-handler, via bridge.content.ts) deze
    // pagina al geteld — bv. Usercentrics via de API én via de knop — dan
    // niet dubbel tellen.
    if (window.__bbConsentHandled) return;
    window.__bbConsentHandled = true;
    try {
      onHandled();
    } catch {
      // teller-callback mag nooit de laag breken
    }
  };

  // Laat de generieke auto-click (laag 5) weer los zodra de motor niets
  // (meer) gaat doen. Nooit na een succesvolle weigering — dan geldt
  // __bbConsentHandled en hoeft laag 5 sowieso niets.
  let watchdogId = 0;
  // Zolang een Sourcepoint-verificatie loopt (zie optOutResult) blijft laag 5
  // wachten — anders klikt die in de nog open manager rond.
  let verifyPending = false;
  const release = (): void => {
    window.clearTimeout(watchdogId);
    if (verifyPending) return;
    if (!handledFired) window.__bbConsentActive = false;
  };

  // v0.4.2 (#170, 7 sep): construeer ZONDER config/rules. De vendored library
  // roept, als config direct aan de constructor wordt meegegeven, synchroon
  // `this.initialize(config, ...)` aan vóórdat de constructor's eigen laatste
  // regel (`this.domActions = new DomActions(this)`) is uitgevoerd. Staat
  // `enablePrehide: true` (onze config) én bestaat `document.documentElement`
  // al (waar is bij document_start) dan roept `initialize()` synchroon
  // `prehideElements()` aan, die weer `this.domActions.prehide(...)` nodig
  // heeft — en dat veld bestaat op dat moment nog niet. Resultaat: een
  // ongevangen TypeError ("Cannot read properties of undefined (reading
  // 'prehide')") op praktisch elke pagina, vóórdat er ook maar iets
  // gedetecteerd is. Ontdekt tijdens de testronde van taak #170 (7 sep) — dit
  // gooide de hele laag stil onderuit sinds ze ooit bestond, want ze stond
  // nooit lang genoeg aan om het te merken. Fix: construeer met `null` als
  // config (en zonder rules), zodat `this.domActions` al bestaat zodra wij
  // zelf `consent.initialize(config, rules)` aanroepen.
  const consent = new AutoConsent(async (msg) => {
    switch (msg.type) {
      case 'eval': {
        // Antwoord altijd asynchroon (evaluateSnippet is async, dus ook de
        // shim-route landt pas ná de huidige sync-run van de library — die
        // registreert z'n pending Deferred pas na het versturen).
        const snippetId = (msg as { snippetId?: string }).snippetId;
        const evalId = msg.id;
        void evaluateSnippet(snippetId).then((result) =>
          consent.receiveMessageCallback({ type: 'evalResp', id: evalId, result }),
        );
        break;
      }
      case 'cmpDetected':
        // Bekende CMP herkend → de generieke auto-click moet even wachten.
        // Waakhond: vindt de motor binnen de tijd geen popup, dan meldt de
        // library dat niet — dan laten wij laag 5 zelf weer los.
        window.__bbConsentActive = true;
        if (msg.cmp === 'Sourcepoint-frame') window.__bbStepIntoBlocked = true;
        window.clearTimeout(watchdogId);
        watchdogId = window.setTimeout(release, CMP_DETECTED_WATCHDOG_MS);
        break;
      case 'popupFound':
        // Popup gevonden → de motor gaat nu écht weigeren; waakhond uit.
        window.clearTimeout(watchdogId);
        break;
      case 'optOutResult': {
        if (!msg.result) {
          release();
          break;
        }
        if (msg.cmp === 'Sourcepoint-frame' && isSourcepointManagerFrame()) {
          // Pas tellen als de manager aantoonbaar weg is (zie kop).
          verifyPending = true;
          const onGone = (): void => markHandled();
          window.addEventListener('pagehide', onGone, { once: true });
          window.setTimeout(() => {
            verifyPending = false;
            if (!sourcepointManagerStillOpen()) {
              markHandled();
              return;
            }
            window.removeEventListener('pagehide', onGone);
            sourcepointGoBack();
            release();
          }, SOURCEPOINT_VERIFY_MS);
          break;
        }
        markHandled();
        break;
      }
      case 'autoconsentDone':
        // Klaar. Niets afgehandeld → laat de fallback-laag weer los.
        release();
        break;
      case 'autoconsentError':
        release();
        break;
      case 'report': {
        // Lifecycle-rapport bij elke state-wijziging. 'nothingDetected' is
        // het enige einde zonder eigen bericht.
        const lifecycle = (msg as { state?: { lifecycle?: string } }).state?.lifecycle;
        if (lifecycle === 'nothingDetected') release();
        break;
      }
      default:
        break;
    }
  });

  try {
    // domActions bestaat nu (constructor is al klaar) — pas hier initialiseren
    // met de échte config + regelset. `initialize()` roept zelf al `start()`
    // aan (direct, of ná DOMContentLoaded als de pagina nog laadt) — dat was
    // ook al zo in de oorspronkelijke, kapotte constructor-route. Een eigen
    // extra `consent.start()` hierna zou het detectieproces dus een tweede
    // keer inplannen; expliciet weggelaten.
    const bundle = rules as unknown as RuleBundle;
    consent.initialize(config, {
      ...bundle,
      autoconsent: [...bundle.autoconsent, ...(BANNERBYE_EXTRA_RULES as RuleBundle['autoconsent'])],
    });
  } catch {
    window.__bbConsentActive = false;
  }
}
