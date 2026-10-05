/** Wat refuse() over een pagina rapporteert. */
export type RefuseOutcome =
  /** Een weigerknop is geklikt en de banner is weg. */
  | 'refused'
  /** Er was geen banner (of de TCF/GPC-voorbereiding voorkwam hem). */
  | 'clean'
  /** Een banner staat er nog, maar er is geen weigerknop gevonden — vaak een consent-or-pay-muur. */
  | 'unresolved';

export interface RefuseClick {
  action: 'reject' | 'stepInto';
  label: string;
  frame: string;
  atMs: number;
}

export interface RefuseResult {
  outcome: RefuseOutcome;
  url: string;
  host: string;
  /** Welke stap(pen) de motor zette, in volgorde. */
  clicks: RefuseClick[];
  /** Structurele signalen van de banner die gevonden werd (indien aanwezig). */
  bannerSignals: string[];
  /** Totale tijd van refuse() in milliseconden. */
  ms: number;
  /** Had de pagina al een TCF-antwoord van prepare()? */
  tcfPrepared: boolean;
}

export interface RefuseOptions {
  /** Hoe lang we blijven zoeken naar een banner/knop. Standaard 8000 ms. */
  timeoutMs?: number;
  /** Hoe vaak we scannen. Standaard 250 ms. */
  pollMs?: number;
  /** Hoe lang we na een klik wachten voordat we de pagina opnieuw bekijken. Standaard 600 ms. */
  settleMs?: number;
  /** Na hoeveel ms zonder banner we 'clean' concluderen. Standaard 1500 ms. */
  cleanAfterMs?: number;
  /** Ook same-process iframes doorzoeken (Playwright/Puppeteer `frames()`). Standaard true. */
  frames?: boolean;
}

/**
 * Minimale pagina-interface: Playwright `Page`, Puppeteer `Page` en hun
 * `Frame`-objecten voldoen allemaal. We vragen bewust niet meer dan dit.
 */
export interface PageLike {
  evaluate<T = unknown>(pageFunction: string | ((...args: never[]) => T), arg?: unknown): Promise<T>;
  url(): string;
  frames?(): PageLike[];
  mainFrame?(): PageLike;
  name?(): string;
}

/** Waar `prepare()` zijn init-script op mag zetten. */
export interface PreparableLike {
  /** Playwright: BrowserContext of Page. */
  addInitScript?(script: string | { content: string }): Promise<unknown>;
  /** Puppeteer: Page. */
  evaluateOnNewDocument?(script: string): Promise<unknown>;
  /** Playwright BrowserContext / Page, Puppeteer Page: extra request-headers. */
  setExtraHTTPHeaders?(headers: Record<string, string>): Promise<unknown>;
}
