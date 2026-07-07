/**
 * Phase 2C (#reward-3) — opt-in "email me when fixed".
 *
 * Stuurt één courtesy-mail naar melders die bij het rapporteren hun e-mail
 * achterlieten, zodra hun host is opgelost. Resend REST API via fetch (zelfde
 * patroon als claude.ts / deploy/api/report.ts — geen SDK-dependency).
 *
 * Env: RESEND_API_KEY (moet als GitHub Actions-secret bestaan). Ontbreekt de
 * key, dan is notify een stille no-op — nooit de analyse-run laten klappen.
 *
 * Privacy: het adres is opt-in en wordt na verzending gewist (clearWatchers in
 * analyze.ts). Eén seintje, geen lijst, geen tracking.
 */

const RESEND_API_ENDPOINT = 'https://api.resend.com/emails';
const FROM = 'BannerBye <hello@bannerbye.com>';

/** Stuur één "nu opgelost"-mail. Returnt true bij succes, false bij falen. */
export async function sendFixedEmail(
  to: string,
  hostname: string,
): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[notify] RESEND_API_KEY ontbreekt — sla notify over.');
    return false;
  }
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
