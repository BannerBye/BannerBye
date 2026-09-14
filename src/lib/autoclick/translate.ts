/**
 * On-device vertaal-fallback — laatste redmiddel voor talen die nergens in
 * REJECT_KEYWORDS, rules.json (remote keywords) of de attribuut-hints
 * gedekt zijn.
 *
 * Gebruikt Chrome/Edge's ingebouwde Translator- en LanguageDetector-API's
 * (stabiel sinds Chrome 138, `self.Translator`/`self.LanguageDetector`).
 * Draait volledig lokaal in de browser — geen netwerkcall, geen tekst die
 * de machine verlaat. Dat past bij BannerBye's "zero passive tracking"-
 * belofte; een cloud-vertaalservice zou die belofte breken.
 *
 * Alleen op Chromium-browsers met de API ingeschakeld. Firefox en Safari
 * hebben deze API niet — feature-detect zorgt dat dit daar een stille
 * no-op is, geen crash en geen vertraging.
 *
 * Dit is bewust de LAATSTE stap in de keten (zie finder.ts voor PASS 1
 * t/m 2, en het overzicht in keywords.ts): vertalen is traag (model kan
 * on-demand gedownload moeten worden) en dus alleen de moeite waard als
 * niets anders al een match vond.
 */

import { collectVisibleTextCandidates } from './finder.ts';
import { isRejectText, isAmbiguousRejectText } from './keywords.ts';

/** Totaalbudget voor de hele vertaal-poging — dit is de állerlaatste stap
 * vóór we opgeven, maar mag de pagina niet seconden lang laten hangen. */
const TRANSLATE_BUDGET_MS = 4000;

/** Max aantal kandidaten dat we vertalen — bound de kosten per pagina. */
const MAX_CANDIDATES = 20;

/** Minimale detectie-zekerheid vóór we een taal als "niet-Engels" aannemen. */
const MIN_DETECT_CONFIDENCE = 0.4;

interface TranslatorHandle {
  translate(text: string): Promise<string>;
}

interface LanguageDetectorHandle {
  detect(text: string): Promise<Array<{ detectedLanguage: string; confidence: number }>>;
}

interface TranslatorFactory {
  create(opts: { sourceLanguage: string; targetLanguage: string }): Promise<TranslatorHandle>;
  availability?(opts: { sourceLanguage: string; targetLanguage: string }): Promise<string>;
}

interface LanguageDetectorFactory {
  create(): Promise<LanguageDetectorHandle>;
}

interface OnDeviceAiGlobal {
  Translator?: TranslatorFactory;
  LanguageDetector?: LanguageDetectorFactory;
}

/**
 * De Translator/LanguageDetector-API's staan (nog) niet in TypeScript's
 * ingebouwde dom.d.ts — vandaar de losse interfaces hierboven en deze cast,
 * i.p.v. te wachten tot @types/dom een lib-versie bijwerkt.
 */
function getOnDeviceAi(): OnDeviceAiGlobal {
  return self as unknown as OnDeviceAiGlobal;
}

/** Wrapt een promise met een timeout; resolved naar null i.p.v. te hangen
 * of te rejecten — deze module mag nooit de caller laten crashen of wachten. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(null);
    }, ms);
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

/**
 * Probeert de reject-knop te vinden via on-device vertaling naar het Engels.
 *
 * Stappen: taal van de pagina detecteren → als niet-Engels en de API's
 * beschikbaar zijn, kandidaat-knopteksten (met leesbaar label) één voor één
 * vertalen en tegen de bestaande EN-keywordlijsten checken (isRejectText /
 * isAmbiguousRejectText — geen zin-fragmenten, die zijn te context-specifiek
 * om betrouwbaar machinaal te vertalen).
 *
 * Faalt altijd stil (try/catch + timeouts overal) — geen enkel pad hier mag
 * de auto-click-flow laten crashen of onnodig lang laten hangen.
 */
export async function tryTranslationFallback(): Promise<HTMLElement | null> {
  try {
    const ai = getOnDeviceAi();
    if (!ai.LanguageDetector || !ai.Translator) return null;

    const sampleText = (document.body?.innerText || '').slice(0, 500).trim();
    if (!sampleText) return null;

    const detector = await withTimeout(ai.LanguageDetector.create(), 1500);
    if (!detector) return null;

    const detected = await withTimeout(detector.detect(sampleText), 1000);
    const top = detected?.[0];
    if (!top?.detectedLanguage) return null;
    if (top.detectedLanguage === 'en') return null; // al Engels, niks te vertalen
    if (top.confidence < MIN_DETECT_CONFIDENCE) return null;

    const sourceLanguage = top.detectedLanguage;

    if (ai.Translator.availability) {
      const availability = await withTimeout(
        ai.Translator.availability({ sourceLanguage, targetLanguage: 'en' }),
        1000,
      );
      // Spec gebruikt strings als 'no'/'unavailable' voor "kan niet" —
      // bij twijfel (null door timeout) proberen we het toch, `create()`
      // faalt dan vanzelf via de buitenste try/catch.
      if (availability === 'no' || availability === 'unavailable') return null;
    }

    const translator = await withTimeout(
      ai.Translator.create({ sourceLanguage, targetLanguage: 'en' }),
      2000,
    );
    if (!translator) return null;

    const candidates = collectVisibleTextCandidates().slice(0, MAX_CANDIDATES);
    if (candidates.length === 0) return null;

    const deadline = Date.now() + TRANSLATE_BUDGET_MS;
    for (const { el, text } of candidates) {
      if (Date.now() > deadline) break;
      // Knoplabels zijn kort — een lange candidate-tekst vertalen kost
      // onnodig budget voor iets dat toch geen knoplabel is.
      if (text.length > 80) continue;

      const translated = await withTimeout(translator.translate(text), 600);
      if (!translated) continue;
      if (isRejectText(translated) || isAmbiguousRejectText(translated)) {
        return el;
      }
    }

    return null;
  } catch {
    return null;
  }
}
