/**
 * BannerBye — onboarding flow.
 *
 * Drie schermen, één keer getoond bij eerste install:
 *   1. What it does — wordmark + tagline + één-zin uitleg
 *   2. How you know it works — popup-icoon + counter
 *   3. How to pause — voor sites die toch consent nodig hebben
 *
 * Klaar = onboardingCompleted=true in chrome.storage.sync, dan tab sluiten.
 * Skip-knop op elk scherm doet hetzelfde — onboarding is een hint,
 * geen blokkade.
 */

import { useState } from 'react';
import { updateSettings } from '@/lib/storage';

const TOTAL_SCREENS = 3;

export function App() {
  const [screen, setScreen] = useState(0);
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

  function next(): void {
    if (screen < TOTAL_SCREENS - 1) {
      setScreen(screen + 1);
    } else {
      void complete();
    }
  }

  return (
    <div className="bb-page">
      <div className="bb-card">
        <header className="bb-header">
          <span className="bb-wordmark">
            <span className="bb-wordmark-ink">Banner</span>
            <span className="bb-wordmark-ember">Bye</span>
          </span>
          <button
            type="button"
            className="bb-skip"
            onClick={() => void complete()}
            disabled={closing}
          >
            Skip
          </button>
        </header>

        <main className="bb-content">
          {screen === 0 && <ScreenOne />}
          {screen === 1 && <ScreenTwo />}
          {screen === 2 && <ScreenThree />}
        </main>

        <footer className="bb-footer">
          <div className="bb-dots" role="tablist" aria-label="Onboarding progress">
            {Array.from({ length: TOTAL_SCREENS }, (_, i) => (
              <span
                key={i}
                className={`bb-dot ${i === screen ? 'active' : ''}`}
                role="tab"
                aria-selected={i === screen}
              />
            ))}
          </div>
          <button
            type="button"
            className="bb-cta"
            onClick={next}
            disabled={closing}
          >
            {screen < TOTAL_SCREENS - 1 ? 'Next →' : 'Start browsing →'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function ScreenOne() {
  return (
    <div className="bb-screen">
      <p className="bb-eyebrow">You're protected</p>
      <h1 className="bb-headline">
        Cookie banners, killed.<br />
        <em>Before they load.</em>
      </h1>
      <p className="bb-body">
        BannerBye sends "no consent" to every site you visit — automatically,
        legally, before they get a chance to ask. Most sites will just stop
        showing the banner. The rest, we click "Reject" for you.
      </p>
    </div>
  );
}

function ScreenTwo() {
  return (
    <div className="bb-screen">
      <p className="bb-eyebrow">How it works</p>
      <h1 className="bb-headline">
        Silently.<br />
        <em>That's the point.</em>
      </h1>
      <p className="bb-body">
        On most sites, you'll just notice you're <em>not</em> being interrupted.
        That's BannerBye doing its thing. Click the shield icon{' '}
        <span className="bb-mono">↗</span> in your toolbar to see how many
        banners we've refused on your behalf.
      </p>
      <p className="bb-tip">
        Tip: pin the icon for one-click access — toolbar puzzle piece →
        find BannerBye → click the pin.
      </p>
    </div>
  );
}

function ScreenThree() {
  return (
    <div className="bb-screen">
      <p className="bb-eyebrow">When sites break</p>
      <h1 className="bb-headline">
        Some sites need cookies.<br />
        <em>Pause us there.</em>
      </h1>
      <p className="bb-body">
        Banking, work tools, login flows — these sometimes need consent
        cookies to function. If a site looks broken: click the shield icon
        and hit <strong>Pause on this site</strong>. We'll stay out of the
        way until you turn us back on.
      </p>
      <p className="bb-body">
        Your choice. Every site. Always reversible.
      </p>
    </div>
  );
}
