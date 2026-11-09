/**
 * Melding-snapshot (v0.4.17, pijplijn v2).
 *
 * WAAROM
 * Tot 0.4.16 stuurde "Report this problem" alleen de hostname mee. De
 * analyse-pijplijn bezocht dan de root van die host met een desktop-browser
 * vanaf een Amerikaans IP, en concludeerde bij geen banner: "waarschijnlijk
 * vals positief". portal.newdaycards.com (nov 2026) liet zien hoe fout dat
 * kan zijn: de root is een 404, de banner staat alleen op /aqua/login, en de
 * melder zat op Android. De pijplijn kon dus niets zien van wat de melder zag.
 *
 * WAT
 * De popup vraagt het autoclick-content-script in het hoofdframe om een
 * snapshot van precies wat er nu op het scherm staat en relevant is voor een
 * consent-beslissing: de zichtbare knoplabels in (of met de woorden van) een
 * cookie-banner, een stukje bannertekst, herkende CMP-containers en de
 * hostnamen van consent-achtige iframes. Plus het pad (zonder query/hash en
 * met tokenachtige segmenten weggepoetst), de paginataal en de viewport.
 *
 * WAT NIET
 * Geen paginatekst buiten de banner, geen formulierwaarden, geen cookies,
 * geen volledige URL's, geen knoplabels buiten de banner tenzij ze zelf een
 * consent-woord bevatten (anders kan "Hi Robin" uit een accountmenu
 * meekomen). Labels worden ontdaan van e-mailadressen en lange cijferreeksen.
 * Alles is hard begrensd (zie de MAX_*-constanten), zowel hier als op de
 * server (api/report.ts valideert opnieuw).
 */

import { collectVisibleTextCandidates, findCookieBannerContainer } from '@/lib/autoclick/finder.ts';
import { hasCookieContext } from '@/lib/autoclick/keywords.ts';

export const SNAPSHOT_VERSION = 1;
export const MAX_CANDIDATES = 40;
export const MAX_LABEL = 160;
export const MAX_BANNER_TEXT = 400;
export const MAX_PATH = 200;
export const MAX_IFRAMES = 5;
export const MAX_CMPS = 8;

export interface SnapshotCandidate {
  /** Zichtbaar label (opgeschoond, begrensd). */
  text: string;
  /** Tagnaam, lowercase. */
  tag: string;
  /** Staat dit element in een herkende cookie-banner-container? */
  inBanner: boolean;
  /** id/class/data-*-tokens (lowercase, begrensd) — taalonafhankelijke hints. */
  attrs?: string[];
}

export interface ReportSnapshot {
  v: number;
  /** Genomen op (ms sinds epoch). */
  at: number;
  /** Zichtbare klikbare labels, banner-eerst. */
  candidates: SnapshotCandidate[];
  /** Is er een banner-container herkend door de extensie zelf? */
  bannerFound: boolean;
  /** Tekst van die container, begrensd. Leeg als niet gevonden. */
  bannerText: string;
  /** CMP's herkend aan DOM-signatures (geen window-globals in ISOLATED). */
  cmps: string[];
  /** Hostnamen van iframes die op consent lijken (alleen hostnamen). */
  iframes: string[];
  /** `document.documentElement.lang`, begrensd. */
  pageLang: string;
  /** `navigator.language`, begrensd. */
  uiLang: string;
  viewport: { w: number; h: number };
  /** Aantal zichtbare klikbare elementen vóór filtering — context voor de analist. */
  totalClickables: number;
}

/** Consent-achtige woorden om labels buiten de banner toch mee te nemen. */
const ACTION_HINTS = [
  'accept', 'agree', 'allow', 'reject', 'decline', 'refuse', 'deny', 'manage', 'preferen',
  'setting', 'customi', 'option', 'consent', 'cookie', 'privacy', 'necessary', 'essential',
  'akkoord', 'accepteer', 'weiger', 'afwijz', 'toestaan', 'beheer', 'instelling', 'aanpassen',
  'noodzakelij', 'zustimm', 'akzeptier', 'ablehn', 'einstellung', 'accepter', 'refuser',
  'paramèt', 'aceptar', 'rechaz', 'configur', 'accetta', 'rifiut', 'impostazion',
];

/** CMP-containers die in het hoofddocument zichtbaar zijn (DOM-only). */
const CMP_SIGNATURES: Array<[string, string]> = [
  ['OneTrust', '#onetrust-banner-sdk, #onetrust-consent-sdk'],
  ['Cookiebot', '#CybotCookiebotDialog'],
  ['Usercentrics', '#usercentrics-root, #usercentrics-cmp-ui'],
  ['Didomi', '#didomi-host, #didomi-popup'],
  ['Quantcast', '.qc-cmp2-container, #qc-cmp2-container'],
  ['Klaro', '.klaro'],
  ['CookieScript', '#cookiescript_injected'],
  ['TrustArc', '#truste-consent-track, #consent_blackbar'],
  ['Osano', '.osano-cm-window'],
  ['Sourcepoint', '[id^="sp_message_container"]'],
  ['iubenda', '#iubenda-cs-banner'],
  ['Cookie Information', '#coiOverlay, #coi-banner-wrapper'],
  ['Complianz', '#cmplz-cookiebanner-container'],
  ['CookieYes', '.cky-consent-container'],
  ['Borlabs', '#BorlabsCookieBox'],
  ['Axeptio', '#axeptio_overlay'],
];

const IFRAME_HINTS = [
  'consent', 'cmp', 'privacy', 'cookie', 'sourcepoint', 'didomi', 'onetrust', 'cookiebot',
  'usercentrics', 'quantcast', 'trustarc', 'iubenda', 'cookielaw', 'consensu', 'privacy-mgmt',
  'contentpass',
];

/** E-mailadressen en lange cijferreeksen uit een label halen. */
export function scrubLabel(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '…')
    .replace(/\d{5,}/g, '…')
    .trim()
    .slice(0, MAX_LABEL);
}

/**
 * Pad opschonen: geen query/hash, tokenachtige segmenten (UUID's, lange
 * hex/base64-achtige strings, cijferreeksen, alles met '@' of '=') worden
 * vervangen door '*'. Begrensd op MAX_PATH. Geeft '/' terug bij twijfel.
 */
export function scrubPath(pathname: string): string {
  if (!pathname || !pathname.startsWith('/')) return '/';
  const parts = pathname.split('/').map((seg) => {
    if (!seg) return seg;
    if (/[@=]/.test(seg)) return '*';
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) return '*';
    if (/^\d{4,}$/.test(seg)) return '*';
    if (seg.length >= 16 && /\d/.test(seg) && /[a-z]/i.test(seg) && !/[-_]/.test(seg.slice(1, -1))) return '*';
    if (seg.length >= 24 && /^[A-Za-z0-9_-]+$/.test(seg) && /\d/.test(seg)) return '*';
    return seg;
  });
  const out = parts.join('/').replace(/\/{2,}/g, '/');
  return out.length > MAX_PATH ? out.slice(0, MAX_PATH) : out;
}

function attrTokens(el: HTMLElement): string[] {
  const raw = [
    el.id,
    typeof el.className === 'string' ? el.className : '',
    el.getAttribute('data-testid') ?? '',
    el.getAttribute('data-action') ?? '',
    el.getAttribute('data-role') ?? '',
    el.getAttribute('data-cookieconsent') ?? '',
    el.getAttribute('data-consent') ?? '',
  ]
    .join(' ')
    .toLowerCase();
  const tokens = raw
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && t.length <= 32 && !/^\d+$/.test(t));
  return Array.from(new Set(tokens)).slice(0, 12);
}

function iframeHostnames(): string[] {
  const out = new Set<string>();
  const own = location.hostname.toLowerCase();
  for (const f of Array.from(document.querySelectorAll('iframe[src]'))) {
    if (out.size >= MAX_IFRAMES) break;
    const src = f.getAttribute('src') ?? '';
    if (!/^https?:/i.test(src)) continue;
    let host = '';
    try {
      host = new URL(src).hostname.toLowerCase();
    } catch {
      continue;
    }
    if (!host || host === own) continue;
    const hay = `${host} ${(f.id ?? '').toLowerCase()} ${(f.getAttribute('title') ?? '').toLowerCase()}`;
    if (IFRAME_HINTS.some((h) => hay.includes(h))) out.add(host);
  }
  return Array.from(out);
}

/**
 * Neemt de snapshot. Draait in het autoclick-content-script (ISOLATED,
 * hoofdframe) op verzoek van de popup. Gooit nooit: bij een fout komt een
 * lege maar geldige snapshot terug, zodat de melding altijd doorgaat.
 */
export function takeReportSnapshot(): ReportSnapshot {
  const base: ReportSnapshot = {
    v: SNAPSHOT_VERSION,
    at: Date.now(),
    candidates: [],
    bannerFound: false,
    bannerText: '',
    cmps: [],
    iframes: [],
    pageLang: (document.documentElement.lang || '').slice(0, 16),
    uiLang: (navigator.language || '').slice(0, 16),
    viewport: { w: window.innerWidth, h: window.innerHeight },
    totalClickables: 0,
  };
  try {
    const all = collectVisibleTextCandidates();
    base.totalClickables = all.length;

    let bannerEl: HTMLElement | null = null;
    const inBanner: SnapshotCandidate[] = [];
    const outside: SnapshotCandidate[] = [];
    const seen = new Set<string>();
    for (const { el, text } of all) {
      const label = scrubLabel(text);
      if (!label) continue;
      const container = findCookieBannerContainer(el);
      const isIn = container !== null;
      if (isIn && !bannerEl) bannerEl = container;
      const key = `${isIn ? 'b' : 'o'}:${label.toLowerCase()}`;
      if (seen.has(key)) continue;
      const lower = label.toLowerCase();
      if (!isIn && !ACTION_HINTS.some((h) => lower.includes(h))) continue;
      seen.add(key);
      const cand: SnapshotCandidate = { text: label, tag: el.tagName.toLowerCase(), inBanner: isIn };
      const attrs = attrTokens(el);
      if (attrs.length) cand.attrs = attrs;
      (isIn ? inBanner : outside).push(cand);
    }
    base.candidates = [...inBanner, ...outside].slice(0, MAX_CANDIDATES);
    base.bannerFound = bannerEl !== null;
    if (bannerEl) {
      const txt = (bannerEl.innerText || bannerEl.textContent || '').replace(/\s+/g, ' ').trim();
      base.bannerText = scrubLabel(txt).slice(0, MAX_BANNER_TEXT);
    } else {
      // Geen container herkend: pak dan de tekst rondom de eerste consent-
      // achtige knop, zodat de pijplijn toch context heeft.
      const first = all.find((c) => {
        const l = c.text.toLowerCase();
        return hasCookieContext(l) || ACTION_HINTS.some((h) => l.includes(h));
      });
      const parent = first?.el.parentElement?.parentElement ?? first?.el.parentElement ?? null;
      if (parent) {
        const txt = (parent.innerText || parent.textContent || '').replace(/\s+/g, ' ').trim();
        if (hasCookieContext(txt)) base.bannerText = scrubLabel(txt).slice(0, MAX_BANNER_TEXT);
      }
    }
    for (const [name, sel] of CMP_SIGNATURES) {
      if (base.cmps.length >= MAX_CMPS) break;
      try {
        if (document.querySelector(sel)) base.cmps.push(name);
      } catch {
        // ongeldige selector kan niet, maar nooit laten klappen
      }
    }
    base.iframes = iframeHostnames();
  } catch {
    // Lege snapshot is prima — de melding gaat gewoon door.
  }
  return base;
}
