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
 * #134 — samenvattingsmail naar de eigenaar na elke analyse-run.
 *
 * `lines` is een kant-en-klare lijst met één regel per onderzochte host
 * (gebouwd in analyze.ts door describeHostOutcome), zodat de mail-logica hier
 * niet zelf hoeft te weten wat een "vals positief" is — dat blijft in de
 * classificatielogica van analyze.ts/classify.ts.
 *
 * Best-effort, zoals sendFixedEmail: een falende mail laat de run nooit
 * klappen, en er wordt niets herhaald (geen queue, geen retry — de volgende
 * run stuurt gewoon zijn eigen samenvatting).
 */
export async function sendOwnerSummaryEmail(
  lines: string[],
  appliedCount: number,
  needsReviewCount: number,
): Promise<boolean> {
  const subject =
    appliedCount > 0
      ? `BannerBye: ${appliedCount} melding(en) automatisch opgelost`
      : needsReviewCount > 0
        ? `BannerBye: ${needsReviewCount} melding(en) verwerkt, review nodig`
        : `BannerBye: melding(en) verwerkt — geen actie nodig`;

  const text = [
    `Analyse-run klaar. ${lines.length} host(s) onderzocht (getriggerd door een nieuwe melding via /api/report).`,
    ``,
    ...lines,
    ``,
    `Fixed-overzicht: https://bannerbye.com/fixed`,
    `Rules: https://github.com/BannerBye/bannerbye-landing/blob/main/rules.json`,
    needsReviewCount > 0
      ? `Review-PR: https://github.com/BannerBye/bannerbye-landing/pulls`
      : '',
    ``,
    `— automatisch verstuurd door de zelfherstellende pijplijn (.github/workflows/phase2b-analyze.yml)`,
  ]
    .filter((l) => l !== '')
    .join('\n');

  return sendEmail(OWNER_EMAIL, subject, text);
}
