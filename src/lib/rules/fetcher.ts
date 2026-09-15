/**
 * Remote rules fetcher — draait in de background service worker.
 *
 * Eén keer per dag haalt de extensie nieuwe rules op van bannerbye.com.
 * Resultaat wordt gecached in chrome.storage.local. Content scripts lezen
 * later uit die cache (ze kunnen zelf niet fetchen vanuit MAIN world).
 *
 * Faalt stil — als de fetch crasht (offline, server down, JSON broken),
 * blijft de bestaande cache + bundled keywords doorwerken.
 */

import type { RemoteRules } from './types.ts';

/** URL waar de remote rules JSON gehost wordt. */
const RULES_URL = 'https://bannerbye.com/rules.json';

/** chrome.storage.local key voor de gecachde rules. */
export const RULES_STORAGE_KEY = 'remoteRules';

/** Naam van de chrome.alarm voor de periodieke fetch. */
const ALARM_NAME = 'bannerbye-rules-fetch';

/** Daily refresh — vaker fetchen voegt geen waarde toe. */
const FETCH_INTERVAL_MIN = 24 * 60;

/**
 * Fetcht rules.json en slaat 'm op in chrome.storage.local.
 * Returnt de fetched rules, of null als er iets fout ging.
 */
export async function fetchRemoteRules(): Promise<RemoteRules | null> {
  try {
    // v0.4.5 (fix #14, security-audit 2026-09-16): 'error' i.p.v. 'follow'.
    // RULES_URL is hardcoded https://bannerbye.com/rules.json, maar
    // 'follow' accepteerde stilzwijgend elke redirect die de server (of een
    // gecompromitteerde tussenlaag/CDN-misconfig) teruggaf — inclusief naar
    // een ander domein. 'error' laat de fetch falen (→ fail-safe, bestaande
    // cache blijft gelden) i.p.v. blind een cross-domain response te
    // accepteren als was het ons eigen rules.json.
    const res = await fetch(RULES_URL, {
      cache: 'no-cache',
      redirect: 'error',
    });
    if (!res.ok) {
      console.warn('[BannerBye] rules.json fetch failed:', res.status);
      return null;
    }

    const json = (await res.json()) as unknown;
    if (!isValidRules(json)) {
      console.warn('[BannerBye] rules.json schema invalid');
      return null;
    }

    await chrome.storage.local.set({ [RULES_STORAGE_KEY]: json });
    return json;
  } catch (err) {
    console.warn('[BannerBye] rules.json fetch error:', err);
    return null;
  }
}

/**
 * Leest de gecachde rules uit chrome.storage.local. Returnt null als
 * er nooit gefetched is, of als de cache corrupt is.
 */
export async function getCachedRules(): Promise<RemoteRules | null> {
  try {
    const result = await chrome.storage.local.get(RULES_STORAGE_KEY);
    const rules = result[RULES_STORAGE_KEY] as unknown;
    return isValidRules(rules) ? rules : null;
  } catch {
    return null;
  }
}

/**
 * Registreert een chrome.alarm die dagelijks `fetchRemoteRules` triggert.
 * Idempotent — meerdere keren callen overschrijft gewoon de alarm-config.
 */
export function scheduleRulesFetch(): void {
  chrome.alarms.create(ALARM_NAME, {
    // Eerste run: ~1 minuut na install/startup zodat we niet de install-flow
    // vertragen, maar we hebben wel snel de eerste rules.
    when: Date.now() + 60_000,
    periodInMinutes: FETCH_INTERVAL_MIN,
  });
}

/** Returnt true als de alarm-payload van ons is. */
export function isRulesFetchAlarm(alarm: chrome.alarms.Alarm): boolean {
  return alarm.name === ALARM_NAME;
}

/**
 * Light schema-validatie. We zijn streng over `version` (must be number)
 * en over de array-types — verkeerde inhoud wordt liever stil genegeerd
 * dan een runtime crash later in de keyword-matchers.
 */
function isValidRules(value: unknown): value is RemoteRules {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  if (typeof obj.version !== 'number') return false;

  const ac = obj.autoclick;
  if (ac !== undefined) {
    if (!ac || typeof ac !== 'object') return false;
    const acObj = ac as Record<string, unknown>;
    if (!isValidAutoclickFields(acObj)) return false;

    // v0.4.5 (fix #3): host-scoped regels — elke waarde moet zelf weer een
    // geldige velden-set zijn. Eén corrupte host-entry maakt het hele
    // rules.json ongeldig (fail-safe: liever de gecachte versie behouden
    // dan een deel van een corrupt bestand toepassen).
    if (acObj.hostRules !== undefined) {
      if (!acObj.hostRules || typeof acObj.hostRules !== 'object' || Array.isArray(acObj.hostRules)) {
        return false;
      }
      for (const hostFields of Object.values(acObj.hostRules as Record<string, unknown>)) {
        if (!hostFields || typeof hostFields !== 'object') return false;
        if (!isValidAutoclickFields(hostFields as Record<string, unknown>)) return false;
      }
    }
  }

  return true;
}

/**
 * v0.4.5 (fix #10, security-audit 2026-09-16): minimumlengte voor
 * attribuut-hints. `attributeWordHints` matcht als EXACT token (WORD-tier)
 * en `attributeCompactHints` als substring tegen de ruwe id/class-string
 * (COMPACT-tier) — zie ATTRIBUTE_REJECT_WORD_HINTS/_COMPACT_HINTS in
 * keywords.ts. Een te kort fragment ("ok", "no", "id") raakt daardoor al
 * snel toevallig een niet-gerelateerd element op een willekeurige site. De
 * bundled lijsten zijn bewust altijd langer dan dit (kortste WORD-hint is
 * "deny", 4 tekens; kortste COMPACT-hint is 9+ tekens) — dwing een
 * vergelijkbare ondergrens nu ook af voor remote aanvullingen, waar we niet
 * zelf de kwaliteit van elk voorstel controleren vóórdat het live gaat.
 */
const MIN_ATTRIBUTE_WORD_HINT_LEN = 3;
const MIN_ATTRIBUTE_COMPACT_HINT_LEN = 6;

/** Valideert de 7 gedeelde keyword-velden (gebruikt zowel globaal als per host-regel). */
function isValidAutoclickFields(fields: Record<string, unknown>): boolean {
  if (fields.rejectKeywords !== undefined && !isStringArray(fields.rejectKeywords)) return false;
  if (fields.ambiguousKeywords !== undefined && !isStringArray(fields.ambiguousKeywords)) return false;
  if (fields.stepIntoKeywords !== undefined && !isStringArray(fields.stepIntoKeywords)) return false;
  if (fields.rejectPhrases !== undefined && !isStringArray(fields.rejectPhrases)) return false;
  if (fields.contextWords !== undefined && !isStringArray(fields.contextWords)) return false;
  if (
    fields.attributeWordHints !== undefined &&
    !isMinLengthStringArray(fields.attributeWordHints, MIN_ATTRIBUTE_WORD_HINT_LEN)
  ) {
    return false;
  }
  if (
    fields.attributeCompactHints !== undefined &&
    !isMinLengthStringArray(fields.attributeCompactHints, MIN_ATTRIBUTE_COMPACT_HINT_LEN)
  ) {
    return false;
  }
  return true;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function isMinLengthStringArray(value: unknown, minLen: number): boolean {
  return (
    Array.isArray(value) &&
    value.every((v) => typeof v === 'string' && v.trim().length >= minLen)
  );
}
