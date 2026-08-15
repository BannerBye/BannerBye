/**
 * Registry van alle CMP-handlers.
 *
 * Volgorde maakt uit: de eerste handler wiens `detect()` true returnt
 * krijgt de beurt. We zetten Didomi voorop omdat die de eerste was die
 * we tegenkwamen die niet via standaard TCF te killen was. Als er een
 * pagina is met meerdere CMPs (zelden), kies de meest-aanwezige.
 */

import type { CmpHandler } from './types.ts';
import { didomiHandler } from './didomi.ts';
import { usercentricsHandler } from './usercentrics.ts';

export type { CmpHandler } from './types.ts';
export { didomiHandler } from './didomi.ts';
export { usercentricsHandler } from './usercentrics.ts';

/**
 * Volledige lijst met handlers, in evaluatie-volgorde.
 *
 * TODO: implementeer deze in volgende iteraties:
 *  - onetrustHandler (cmpId 411) — DPG, RTL, etc.
 *  - cookiebotHandler (cmpId 14) — veel SMB
 *  - trustarcHandler — enterprise US
 */
export const handlers: readonly CmpHandler[] = [
  didomiHandler,
  // v0.3.5 (report pamo-design.de): Usercentrics v2 (UC_UI) + v3 (__ucCmp).
  usercentricsHandler,
];
