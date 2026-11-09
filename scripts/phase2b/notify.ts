/**
 * Phase 2C (#reward-3) — opt-in "email me when fixed", plus #134 — de
 * samenvattingsmail naar de eigenaar na elke analyse-run.
 *
 * sendFixedEmail(): één courtesy-mail naar melders die bij het rapporteren
 * hun e-mail achterlieten, zodra hun host is opgelost.
 *
 * sendOwnerSummaryEmail(): stuurt Robin na ELKE run (niet alleen bij succes)
 * een overzicht van wat er met elke gemelde host is gebeurd — opgelost,
 * naar handmatige review, vals positief (geen banner meer gevonden), of een
 * technische fout. Dit is het antwoord op "rapporteer mij ook wat de
 * oplossing is geweest, of dat het misschien een vals positief was" — Robin
 * hoeft niet meer zelf de GitHub Action-logs te lezen.
 *
 * Beide via Resend REST API via fetch (zelfde patroon als claude.ts /
 * deploy/api/report.ts — geen SDK-dependency).
 *
 * Env: RESEND_API_KEY (moet als GitHub Actions-secret bestaan). Ontbreekt de
 * key, dan is elke mail-functie een stille no-op — nooit de analyse-run
 * laten klappen op een ontbrekende secret.
 *
 * Privacy (sendFixedEmail): het adres is opt-in en wordt na verzending
 * gewist (clearWatchers in analyze.ts). Eén seintje, geen lijst, geen
 * tracking. sendOwnerSummaryEmail gaat altijd naar hetzelfde vaste adres van
 * de eigenaar, geen lijst, geen opt-in nodig.
 */

const RESEND_API_ENDPOINT = 'https://api.resend.com/emails';
const FROM = 'BannerBye <hello@bannerbye.com>';
const OWNER_EMAIL = 'robin@live-impact.nl';

/** Generieke Resend-send. Best-effort: logt en geeft false terug bij falen, gooit nooit. */
async function sendEmail(to: string, subject: string, text: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[notify] RESEND_API_KEY ontbreekt — sla mail over.');
    return false;
  }
  try {
    const res = await fetch(RESEND_API_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: FROM, to, subject, text }),
    });
    if (!res.ok) {
      console.error('[notify] Resend HTTP', res.status, (await res.text()).slice(0, 200));
      return false;
    }
    return true;
  } catch (err) {
    console.error('[notify] send failed:', err);
    return false;
  }
}

/** Stuur één "nu opgelost"-mail. Returnt true bij succes, false bij falen. */
export async function sendFixedEmail(
  to: string,
  hostname: string,
): Promise<boolean> {
  const subject = `The banner you reported on ${hostname} is now handled`;
  const text = [
    `Good news — the cookie banner you reported on ${hostname} is now handled by BannerBye.`,
    ``,
    `Next time you visit ${hostname}, the banner should be refused before it even loads.`,
    `It may take a moment for the update to reach your browser (rules refresh in the background).`,
    ``,
    `Thanks for reporting it. Reports like yours are what keep BannerBye sharp.`,
    ``,
    `— BannerBye`,
    `https://bannerbye.com`,
    ``,
    `You're receiving this one-time email because you opted in when you reported ${hostname}.`,
    `We don't store your address or send anything else.`,
  ].join('\n');

  return sendEmail(to, subject, text);
}

/**
 * v0.4.17 (pijplijn v2) — samenvattingsmail aan de eigenaar, per host een
 * blok: wat de melder zag, wat wij probeerden, wat de uitkomst is en wat
 * Robin nog moet doen. Het onderwerp zegt meteen of er iets van hem wordt
 * verwacht. Best-effort: een mislukte mail laat de run nooit klappen.
 */
export interface OwnerHostBlock {
  hostname: string;
  ticketStatus: 'fixed' | 'investigating' | 'not-a-bug';
  reporterSaw: string;
  weTried: string;
  outcome: string;
  todo: string;
  /** Twee zinnen duiding van Claude; leeg als die faalde. */
  explanation: string;
  urgent: boolean;
}

export async function sendOwnerSummaryEmail(
  blocks: OwnerHostBlock[],
  counts: { live: number; review: number; human: number; retry: number; retryMode: boolean },
): Promise<boolean> {
  const needsRobin = counts.review + counts.human;
  const subject =
    needsRobin > 0
      ? `BannerBye: ${needsRobin} melding(en) wachten op jou${counts.live ? `, ${counts.live} al live` : ''}`
      : counts.live > 0
        ? `BannerBye: ${counts.live} melding(en) automatisch opgelost — niets te doen`
        : counts.retry > 0
          ? `BannerBye: ${counts.retry} melding(en) nog niet gereproduceerd — herhaalpoging gepland`
          : `BannerBye: melding(en) verwerkt — niets te doen`;

  const urgentFirst = [...blocks].sort((a, b) => Number(b.urgent) - Number(a.urgent));
  const body: string[] = [];
  body.push(
    `${counts.retryMode ? 'Herhaalpoging' : 'Analyse-run'} klaar: ${blocks.length} host(s). ` +
      `Live (host-scoped): ${counts.live} · naar review: ${counts.review} · herhaalpoging gepland: ${counts.retry} · jouw blik nodig: ${counts.human}.`,
  );
  body.push('');
  for (const b of urgentFirst) {
    body.push(`${b.urgent ? '🙋' : '✅'} ${b.hostname}  [ticket: ${b.ticketStatus}]`);
    if (b.explanation) body.push(`   ${b.explanation}`);
    body.push(`   Melder zag:      ${b.reporterSaw}`);
    body.push(`   Wij probeerden:  ${b.weTried}`);
    body.push(`   Uitkomst:        ${b.outcome}`);
    body.push(`   Jij hoeft:       ${b.todo}`);
    body.push('');
  }
  body.push(`Fixed-overzicht: https://bannerbye.com/fixed`);
  body.push(`Rules (host-regels staan onder autoclick.hostRules): https://github.com/BannerBye/bannerbye-landing/blob/main/rules.json`);
  if (counts.review > 0) body.push(`Review-PR: https://github.com/BannerBye/bannerbye-landing/pulls`);
  body.push(`Run-logs: https://github.com/BannerBye/BannerBye/actions/workflows/phase2b-analyze.yml`);
  body.push('');
  body.push(`— pijplijn v2 (.github/workflows/phase2b-analyze.yml). Host-scoped fixes gaan live zonder PR (bewuste uitzondering op security-fix #1, blast radius één host); globale keywords alleen via de PR.`);

  return sendEmail(OWNER_EMAIL, subject, body.join('\n'));
}
