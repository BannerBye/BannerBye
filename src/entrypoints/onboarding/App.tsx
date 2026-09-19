/**
 * BannerBye — onboarding flow.
 *
 * v0.3.2 (#151): één scherm — een "Quick setup"-checklijst — in plaats van
 * de vorige Next→Next→Next-flow over 3 schermen. Aanleiding: concurrentie-
 * onderzoek naar Super Agent's v4.0-redesign (checkbox-selectie i.p.v.
 * menu's doorlopen) — zie BannerBye_Concurrentie-Hush-SuperAgent_v1.md,
 * optimalisatiepunt 1. BannerBye heeft geen voorkeuren-wizard nodig (we
 * weigeren al standaard alles), maar het "één scherm, geen doorklikken"-
 * principe is hier wél 1-op-1 toepasbaar: dezelfde drie inhoudelijke
 * punten (wat het doet, hoe je het ziet werken, hoe je pauzeert) staan nu
 * als scanbare checklist-items op één scherm, elk al "aangevinkt" omdat
 * BannerBye die bescherming al actief heeft vanaf install — geen keuzes
 * nodig, alleen bevestiging.
 *
 * Klaar = onboardingCompleted=true in chrome.storage.sync, dan tab sluiten.
 */

import { useState } from 'react';
import { updateSettings } from '@/lib/storage';
import { t } from '@/lib/i18n/t';

export function App() {
  const [closing, setClosing] = useState(false);

  async function complete(): Promise<void> {
    if (closing) return;
    setClosing(true);
    try {
      await updateSettings({ onboardingCompleted: true });
    } catch {
      // Storage write failed — niet kritiek, gewoon tab sluiten.
    }
    try {
      const tab = await chrome.tabs.getCurrent();
      if (tab?.id !== undefined) {
        await chrome.tabs.remove(tab.id);
        return;
      }
    } catch {
      // chrome.tabs.* not available or failed — fallback to window.close
    }
    window.close();
  }

  return (
    <div className="bb-page">
      <div className="bb-card">
        <header className="bb-header">
          <span className="bb-wordmark">
            <span className="bb-wordmark-ink">Banner</span>
            <span className="bb-wordmark-ember">Bye</span>
          </span>
        </header>

        <main className="bb-content">
          <div className="bb-screen">
            <p className="bb-eyebrow">{t('onboarding_eyebrow')}</p>
            <h1 className="bb-headline">
              {t('onboarding_headline_1')}<br />
              <em>{t('onboarding_headline_2')}</em>
            </h1>
            <p className="bb-body">{t('onboarding_body')}</p>

            <ul className="bb-checklist">
              <li className="bb-check-item">
                <span className="bb-check-mark" aria-hidden="true">✓</span>
                <div>
                  <p className="bb-check-title">{t('onboarding_check1_title')}</p>
                  <p className="bb-check-desc">{t('onboarding_check1_desc')}</p>
                </div>
              </li>
              <li className="bb-check-item">
                <span className="bb-check-mark" aria-hidden="true">✓</span>
                <div>
                  <p className="bb-check-title">{t('onboarding_check2_title')}</p>
                  <p className="bb-check-desc">{t('onboarding_check2_desc')}</p>
                </div>
              </li>
              <li className="bb-check-item">
                <span className="bb-check-mark" aria-hidden="true">✓</span>
                <div>
                  <p className="bb-check-title">{t('onboarding_check3_title')}</p>
                  <p className="bb-check-desc">{t('onboarding_check3_desc')}</p>
                </div>
              </li>
            </ul>

            <p className="bb-tip">{t('onboarding_tip')}</p>
          </div>
        </main>

        <footer className="bb-footer">
          <button
            type="button"
            className="bb-cta"
            onClick={() => void complete()}
            disabled={closing}
          >
            {t('onboarding_cta')}
          </button>
        </footer>
      </div>
    </div>
  );
}
