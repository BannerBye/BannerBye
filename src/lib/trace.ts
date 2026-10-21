/**
 * Technische trace per tab (v0.4.12, 21 okt 2026).
 *
 * Wie een site meldt is meestal technisch. De popup zei tot nu toe alleen
 * "Refused here: didomi" of "Nothing to refuse here yet." — eerlijk, maar
 * het verklaart niets. Elke laag wéét tijdens de paginalaad precies wat er
 * gebeurde (stub geplaatst, CMP herkend, welke knop, hoeveel kandidaten,
 * waarom een muur) en gooide dat weg. Deze module bewaart het tot de popup
 * opengaat.
 *
 * Ontwerp (zie 04. Output/BannerBye/BannerBye_Brief_Technische-Details-Popup):
 *   - Elke laag meldt korte stappen: `{layer, msg}`.
 *       MAIN-world scripts (gpc/tcf/cmp) kunnen chrome.runtime niet bereiken
 *       → `traceMain()` dispatcht een CustomEvent op `document`; de bridge
 *       (ISOLATED) stuurt 'm door. ISOLATED scripts gebruiken `traceIso()`.
 *   - De background bewaart per tabId een lijstje in chrome.storage.session
 *     (MV3; Firefox 115+ en Safari 16.4+) met een in-memory Map als fallback.
 *     Gewist bij een nieuwe hoofdframe-navigatie, weg met de browsersessie.
 *     Niets op schijf → geen wijziging in de privacyverklaring.
 *   - De popup vraagt `bb:get-trace` voor de actieve tab en toont het onder
 *     een grijze "Details"-link. Copy = platte tekst; "Report with details"
 *     zet de trace in het meldbericht (max 2000 tekens, past ruim).
 *
 * Wat er NIET in mag: URL's met pad/querystring (alleen hostnames), paginatekst
 * buiten de kandidaat-knoppen, cookies. Knopteksten zijn de enige "inhoud" en
 * die leest laag 5 nu ook al. Berichten zijn begrensd op MAX_MSG tekens en
 * MAX_STEPS stappen per pagina (ook een vangrail tegen spoofing vanuit de
 * pagina, zelfde argument als bridge.content.ts fix #7: schade beperken, niet
 * onvervalsbaar maken — de trace stuurt niets aan, hij toont alleen).
 */

export const TRACE_LAYERS = ['gpc', 'tcf', 'auto', 'cmp', 'click', 'wall', 'brake', 'result'] as const;
export type TraceLayer = (typeof TRACE_LAYERS)[number];

export interface TraceStep {
  /** ms sinds de navigatie (performance.now() in het frame; de background rondt af). */
  t: number;
  layer: TraceLayer;
  msg: string;
  /** 'main' of de hostnaam van het iframe. */
  frame: string;
}

export interface TabTrace {
  host: string;
  startedAt: number;
  steps: TraceStep[];
}

export const TRACE_EVENT = 'bb:trace';
export const MAX_MSG = 160;
export const MAX_STEPS = 40;

/** Opschonen van een bericht: alleen printbare tekens, begrensd. */
export function cleanTraceMsg(msg: unknown): string {
  if (typeof msg !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return msg.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_MSG);
}

export function isTraceLayer(v: unknown): v is TraceLayer {
  return typeof v === 'string' && (TRACE_LAYERS as readonly string[]).includes(v);
}

function nowMs(): number {
  try {
    return Math.round(performance.now());
  } catch {
    return 0;
  }
}

/** Knoptekst veilig in een trace-regel: aanhalingstekens, begrensd. */
export function quoteText(text: string, max = 40): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return `"${t.length > max ? `${t.slice(0, max - 1)}…` : t}"`;
}

/**
 * MAIN-world: dispatch op `document` (gedeeld met de ISOLATED bridge; events
 * op `window` reizen niet cross-world in Chrome MV3).
 */
export function traceMain(layer: TraceLayer, msg: string): void {
  try {
    document.dispatchEvent(
      new CustomEvent(TRACE_EVENT, { detail: { layer, msg: cleanTraceMsg(msg), t: nowMs() } }),
    );
  } catch {
    // Nooit de laag breken om een trace-regel.
  }
}

/** ISOLATED-world content scripts: rechtstreeks naar de background. */
export function traceIso(layer: TraceLayer, msg: string): void {
  try {
    void chrome.runtime.sendMessage({ type: TRACE_EVENT, layer, msg: cleanTraceMsg(msg), t: nowMs() });
  } catch {
    // Background idle of frame al weg — niet kritiek.
  }
}

/** Platte tekst voor Copy en voor het meldbericht. */
export function formatTrace(trace: TabTrace | null, meta: { version: string; browser: string }): string {
  const lines: string[] = [];
  lines.push(`BannerBye ${meta.version} · ${meta.browser}`);
  if (!trace || trace.steps.length === 0) {
    lines.push('no trace for this tab (page loaded before the popup opened this session, or BannerBye is paused here)');
    return lines.join('\n');
  }
  lines.push(`host    ${trace.host}`);
  const frames = new Set(trace.steps.map((s) => s.frame).filter((f) => f !== 'main'));
  if (frames.size) lines.push(`frames  main + ${[...frames].join(', ')}`);
  for (const s of trace.steps) {
    const t = `t=+${s.t}ms`.padEnd(11);
    const frame = s.frame === 'main' ? '' : ` [${s.frame}]`;
    lines.push(`${t}${s.layer.padEnd(7)}${s.msg}${frame}`);
  }
  return lines.join('\n');
}

/** Korte browsernaam uit de user agent — alleen voor de trace-kop. */
export function browserLabel(): string {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  if (/Edg\//.test(ua)) return 'Edge';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return /iPhone|iPad/.test(ua) ? 'Safari iOS' : 'Safari';
  return 'browser';
}
