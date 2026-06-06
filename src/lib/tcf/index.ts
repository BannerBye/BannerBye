/**
 * Public API voor TCF-string-generatie.
 *
 * Volgende stap (taak #43, deel 2): koppel deze generator aan
 * een `__tcfapi` content script (eigen entrypoint, ISOLATED world,
 * postMessage-bridge naar MAIN world voor de window-callback).
 */

export { generateNoConsentString } from './tcstring.ts';
export type { TCStringOptions } from './tcstring.ts';
export { BitWriter } from './bitwriter.ts';
export { buildNoConsentTCData } from './tcdata.ts';
export type { TCData } from './tcdata.ts';
