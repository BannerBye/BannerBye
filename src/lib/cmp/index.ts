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

export type { CmpHandler } from './types.ts';
export { didomiHandler } from './didomi.ts';

/**
 * Volledige lijst met handlers, in evaluatie-volgorde.
 *
 * TODO: implementeer deze in volgende iteraties:
 *  - onetrustHandler (cmpId 411) — DPG, RTL, etc.
 *  - cookiebotHandler (cmpId 14) — veel SMB
 *  - usercentricsHandler (cmpId 5) — DACH-regio
 *  - trustarcHandler — enterprise US
 */
export const handlers: readonly CmpHandler[] = [
  didomiHandler,
];
