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
    const res = await fetch(RULES_URL, {
      cache: 'no-cache',
      redirect: 'follow',
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
    if (acObj.rejectKeywords !== undefined && !isStringArray(acObj.rejectKeywords)) return false;
    if (acObj.ambiguousKeywords !== undefined && !isStringArray(acObj.ambiguousKeywords)) return false;
    if (acObj.stepIntoKeywords !== undefined && !isStringArray(acObj.stepIntoKeywords)) return false;
  }

  return true;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}
