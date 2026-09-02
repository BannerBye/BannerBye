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
import { onetrustHandler } from './onetrust.ts';
import { cookiebotHandler } from './cookiebot.ts';
import { trustarcHandler } from './trustarc.ts';

export type { CmpHandler } from './types.ts';
export { didomiHandler } from './didomi.ts';
export { usercentricsHandler } from './usercentrics.ts';
export { onetrustHandler } from './onetrust.ts';
export { cookiebotHandler } from './cookiebot.ts';
export { trustarcHandler } from './trustarc.ts';

/**
 * Volledige lijst met handlers, in evaluatie-volgorde.
 *
 * OneTrust/Cookiebot vooraan: beide hebben een gedocumenteerde publieke
 * reject-API en zijn de meest voorkomende enterprise/SMB-CMPs na Didomi/
 * Usercentrics. TrustArc staat laatst — geen publieke API, best-effort
 * DOM-klik (zie trustarc.ts voor de volledige onderbouwing).
 */
export const handlers: readonly CmpHandler[] = [
  didomiHandler,
  // v0.3.5 (report pamo-design.de): Usercentrics v2 (UC_UI) + v3 (__ucCmp).
  usercentricsHandler,
  // v0.4.1 (#182): de drie CMPs die al jaren in de listings/skill werden
  // geclaimd maar nooit gebouwd waren — zie SKILL.md §1/§13 voor de
  // geschiedenis van die claim.
  onetrustHandler,
  cookiebotHandler,
  trustarcHandler,
];
