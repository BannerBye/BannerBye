/**
 * Pijplijn v3 (nov 2026) — het eindoordeel per gemelde host, als pure functie.
 *
 * WAAROM DIT BESTAND BESTAAT
 * Tussen oktober en november 2026 meldde de pijplijn bij minstens tien hosts
 * "geen actie nodig" of zette ze het ticket op not-a-bug, terwijl er wel een
 * bug was: claude.ai, raiplay.it, ilfattoquotidiano.it, gizmodo.com,
 * portal.newdaycards.com, twinseasons.de, openground.club, duckduckgo.com,
 * reactormag.com en freeletics.com. Drie oorzaken:
 *   1. Er werd alleen getest of er een banner was, nooit of BannerBye hem
 *      weigerde. De meeste gemiste bugs zaten in het gedrag van de extensie
 *      (klik werkt niet, herlaadlus, verkeerde knop, laag stond uit).
 *   2. accept-only en betaalmuur sloten het ticket op een woordenlijst alleen
 *      (freeletics: "Nur notwendige Cookies akzeptieren" telde als accepteren).
 *   3. Onzekere uitkomsten ("onbekend", "afgewezen", "mogelijk timing") zagen
 *      eruit als afgehandeld.
 *
 * DE REGEL
 * Een melding is bewijs dat er iets mis is. Alleen een BEWEZEN uitkomst mag
 * zeggen dat Robin niets hoeft te doen:
 *   - live: een fix staat live;
 *   - retry: er is een herhaalpoging gepland (nog geen oordeel);
 *   - not-a-bug: alleen als een onafhankelijke tweede controle bevestigt dat
 *     de banner echt geen gratis weigerroute heeft, én de extensiecheck niets
 *     tegenstrijdigs zag.
 * Al het andere vraagt Robins blik en houdt het ticket op investigating.
 * Twijfel, een mislukte controle of een ontbrekende controle telt nooit als
 * bewijs voor "niets aan de hand".
 *
 * Getest in test/verdict.test.ts. Wijzig deze regels niet zonder daar een
 * geval bij te zetten.
 */

/** Uitkomst van de tweede controle bij accept-only of een betaalmuur. */
export type RefuseRouteCheck =
  /** Tweede controle bevestigt: geen enkele gratis weigerroute. */
  | { result: 'none'; reason: string }
  /** Tweede controle ziet wél een weigerroute (classificatie zat fout). */
  | { result: 'found'; button: string; reason: string }
  /** Twijfel, fout, geen knoppen om te beoordelen of niet uitgevoerd. */
  | { result: 'unsure'; reason: string };

/** Uitkomst van het bezoek met de echte extensie geladen. */
export interface ExtensionCheck {
  /** False als de extensie niet geladen kon worden of het bezoek faalde. */
  ran: boolean;
  /** Banner nog zichtbaar na het wachten, met BannerBye actief. */
  bannerStill: boolean;
  /** Aantal hoofdframe-navigaties tijdens het bezoek (lus-detectie). */
  navigations: number;
  /** Lus volgens de drempel in extcheck.ts. */
  loop: boolean;
  note: string;
}

export type BaseKind =
  | 'live'
  | 'review'
  | 'rejected'
  | 'wall'
  | 'accept_only'
  | 'cmp_iframe'
  | 'language_gap'
  | 'retry'
  | 'needs_human'
  | 'error'
  | 'unknown';

export interface VerdictInput {
  base: BaseKind;
  refuseRoute?: RefuseRouteCheck;
  extension?: ExtensionCheck;
}

export type FinalKind =
  | BaseKind
  /** accept-only/muur, maar de tweede controle ziet een weigerroute. */
  | 'misclassified'
  /** accept-only/muur, maar de tweede controle kon het niet bevestigen. */
  | 'unverified_close';

export interface Verdict {
  kind: FinalKind;
  ticket: 'fixed' | 'investigating' | 'not-a-bug';
  /** True = Robin moet kijken. Alleen false bij een bewezen uitkomst. */
  needsRobin: boolean;
  /** Extensie bewees zelf dat het misgaat (banner bleef staan of lus). */
  confirmedBroken: boolean;
}

export function decideVerdict(input: VerdictInput): Verdict {
  const ext = input.extension;
  const confirmedBroken = !!ext && ext.ran && (ext.loop || ext.bannerStill);
  // Een lus is altijd een bug, ook op een betaalmuur of accept-only banner.
  const loop = !!ext && ext.ran && ext.loop;

  switch (input.base) {
    case 'live':
      return { kind: 'live', ticket: 'fixed', needsRobin: loop, confirmedBroken: loop };
    case 'retry':
      return { kind: 'retry', ticket: 'investigating', needsRobin: false, confirmedBroken: false };
    case 'wall':
    case 'accept_only': {
      const rr = input.refuseRoute;
      if (!loop && rr && rr.result === 'none') {
        return { kind: input.base, ticket: 'not-a-bug', needsRobin: false, confirmedBroken: false };
      }
      const kind: FinalKind = rr && rr.result === 'found' ? 'misclassified' : loop ? input.base : 'unverified_close';
      return { kind, ticket: 'investigating', needsRobin: true, confirmedBroken: loop || (rr?.result === 'found' && confirmedBroken) };
    }
    default:
      return { kind: input.base, ticket: 'investigating', needsRobin: true, confirmedBroken };
  }
}

/** Mag het mailonderwerp "niets te doen" zeggen? Alleen als niemand Robin nodig heeft. */
export function nothingToDo(verdicts: Verdict[]): boolean {
  return verdicts.every((v) => !v.needsRobin);
}

const REASSURING = [
  /hoeft (hij |robin |je |jij )?(verder )?niets/i,
  /niets te doen/i,
  /geen actie (nodig|vereist)/i,
  /geen (verdere )?actie/i,
  /niet(s)? aan de hand/i,
  /geen bug/i,
  /bekend patroon/i,
];

/**
 * De Claude-duiding mag nooit geruststellen als het oordeel zegt dat Robin
 * moet kijken (freeletics-mail: "de melder hoeft niets te doen, dit is een
 * bekend patroon"). Gooit de duiding dan weg.
 */
export function safeExplanation(text: string, verdict: Verdict): string {
  if (!text) return '';
  if (verdict.needsRobin && REASSURING.some((re) => re.test(text))) return '';
  return text;
}
