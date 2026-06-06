/**
 * BannerBye — popup
 *
 * Twee toggles:
 *  - Globaal aan/uit (zet de hele extensie stil)
 *  - Pause voor deze site (alleen op de huidige tab)
 *
 * Plus een lokale teller "blocked today/total" en een
 * "report broken site"-knop die een prefilled mail naar
 * hello@bannerbye.com opent. (Geen GitHub-issue tot de repo
 * publiek is — zie #39 in de roadmap.)
 */

import { useEffect, useState } from 'react';
import {
  getSettings,
  updateSettings,
  setPausedForSite,
  getStats,
  clearPendingCelebration,
} from '@/lib/storage';
import { isHostPaused, normalizeHost } from '@/lib/host';
import { getMilestoneById, MILESTONES, type Milestone } from '@/lib/milestones';
import { downloadShareCard, downloadStatsCard } from '@/lib/share-card';
import type { LocalStats, SyncedSettings } from '@/lib/types';

const REPORT_ENDPOINT = 'https://bannerbye.com/api/report';

type ReportStatus = 'idle' | 'sending' | 'sent' | 'error';

interface PopupState {
  settings: SyncedSettings;
  stats: LocalStats;
  /** Hostname van de actieve tab, of null als chrome:// of dergelijke. */
  hostname: string | null;
  loading: boolean;
  /** v0.2.0: Report-modal state. null = modal dicht. */
  reportModal: {
    hostname: string;
    message: string;
    status: ReportStatus;
    errorText: string;
  } | null;
}

async function getActiveTabHost(): Promise<string | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return null;
  return normalizeHost(tab.url);
}

export function App() {
  const [state, setState] = useState<PopupState>({
    settings: { enabled: true, pausedSites: [], onboardingCompleted: false },
    stats: { blocked: 0, installedAt: 0, unlockedMilestones: [], pendingCelebrations: [] },
    hostname: null,
    loading: true,
    reportModal: null,
  });

  useEffect(() => {
    void (async () => {
      const [settings, stats, hostname] = await Promise.all([
        getSettings(),
        getStats(),
        getActiveTabHost(),
      ]);
      setState({ settings, stats, hostname, loading: false, reportModal: null });
    })();
  }, []);

  const isSitePaused = state.hostname
    ? isHostPaused(state.hostname, state.settings.pausedSites)
    : false;

  const isActiveOnSite =
    state.settings.enabled && state.hostname !== null && !isSitePaused;

  async function toggleGlobal() {
    const next = await updateSettings({ enabled: !state.settings.enabled });
    setState((s) => ({ ...s, settings: next }));
  }

  async function togglePauseSite() {
    if (!state.hostname) return;
    const next = await setPausedForSite(state.hostname, !isSitePaused);
    setState((s) => ({ ...s, settings: next }));
  }

  /** Eerste in pendingCelebrations → toon als card. Lookup via stable id. */
  const firstPendingId = state.stats.pendingCelebrations[0];
  const currentCelebration: Milestone | null =
    firstPendingId !== undefined
      ? (getMilestoneById(firstPendingId) ?? null)
      : null;

  async function dismissCelebration() {
    if (!currentCelebration) return;
    const nextStats = await clearPendingCelebration(currentCelebration.id);
    setState((s) => ({ ...s, stats: nextStats }));
    // Geen handmatige badge-clear meer hier — chrome.storage.local.set
    // in clearPendingCelebration triggert background.onChanged → syncRankBadge,
    // dat de "🎉" vervangt door het persistente rang-getal (#85).
  }

  /** Share-card download (#87). Genereert 1200x630 PNG met milestone-info. */
  function shareCelebration() {
    if (!currentCelebration) return;
    try {
      downloadShareCard(currentCelebration, state.stats.blocked);
    } catch (err) {
      console.warn('[BannerBye] share-card generation failed:', err);
    }
  }

  /** Stats-share download (#88). Year-in-review-style overzicht. */
  function shareStats() {
    try {
      const unlockedCount = MILESTONES.filter((m) =>
        state.stats.unlockedMilestones.includes(m.id),
      ).length;
      downloadStatsCard(
        state.stats.blocked,
        unlockedCount,
        state.stats.installedAt,
      );
    } catch (err) {
      console.warn('[BannerBye] stats-card generation failed:', err);
    }
  }

  function reportBrokenSite() {
    if (!state.hostname) return;
    setState((s) => ({
      ...s,
      reportModal: {
        hostname: state.hostname!,
        message: '',
        status: 'idle',
        errorText: '',
      },
    }));
  }

  function updateReportMessage(message: string) {
    setState((s) => ({
      ...s,
      reportModal: s.reportModal ? { ...s.reportModal, message } : null,
    }));
  }

  async function sendReport() {
    if (!state.reportModal) return;
    const { hostname, message } = state.reportModal;
    setState((s) => ({
      ...s,
      reportModal: s.reportModal
        ? { ...s.reportModal, status: 'sending', errorText: '' }
        : null,
    }));
    try {
      const res = await fetch(REPORT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hostname,
          version: chrome.runtime.getManifest().version,
          message,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setState((s) => ({
        ...s,
        reportModal: s.reportModal
          ? { ...s.reportModal, status: 'sent', errorText: '' }
          : null,
      }));
      // Auto-close na 1.8 sec.
      setTimeout(() => {
        setState((s) =>
          s.reportModal?.status === 'sent' ? { ...s, reportModal: null } : s,
        );
      }, 1800);
    } catch (err) {
      const text = err instanceof Error ? err.message : 'Network error';
      setState((s) => ({
        ...s,
        reportModal: s.reportModal
          ? { ...s.reportModal, status: 'error', errorText: text }
          : null,
      }));
    }
  }

  function closeReportModal() {
    setState((s) => ({ ...s, reportModal: null }));
  }

  if (state.loading) {
    return <div className="bb-loading">Loading…</div>;
  }

  return (
    <div className="bb-popup">
      {state.reportModal && (
        <div className="bb-modal-overlay" onClick={closeReportModal}>
          <div
            className="bb-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Report broken site"
          >
            <header className="bb-modal-header">
              <p className="bb-modal-title">Report broken site</p>
              <button
                type="button"
                className="bb-modal-close"
                onClick={closeReportModal}
                aria-label="Close"
              >
                ✕
              </button>
            </header>

            {state.reportModal.status === 'sent' ? (
              <p className="bb-modal-sent">
                Thanks. We'll take a look at <span className="bb-modal-email">{state.reportModal.hostname}</span>.
              </p>
            ) : (
              <>
                <p className="bb-modal-help">
                  We'll send the hostname{' '}
                  <span className="bb-modal-email">{state.reportModal.hostname}</span>{' '}
                  to BannerBye. Optional: add what's going wrong.
                </p>
                <textarea
                  className="bb-modal-textarea"
                  placeholder="What's happening? (optional)"
                  value={state.reportModal.message}
                  onChange={(e) => updateReportMessage(e.target.value)}
                  rows={4}
                  maxLength={2000}
                  disabled={state.reportModal.status === 'sending'}
                />
                {state.reportModal.status === 'error' && (
                  <p className="bb-modal-error">
                    Couldn't send: {state.reportModal.errorText}
                  </p>
                )}
                <button
                  type="button"
                  className="bb-modal-copy"
                  onClick={() => void sendReport()}
                  disabled={state.reportModal.status === 'sending'}
                >
                  {state.reportModal.status === 'sending'
                    ? 'Sending…'
                    : state.reportModal.status === 'error'
                      ? 'Try again'
                      : 'Send report'}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      <header className="bb-header">
        <span className="bb-wordmark">
          <span className="bb-wordmark-ink">Banner</span>
          <span className="bb-wordmark-ember">Bye</span>
        </span>
        <span
          className={`bb-status-dot ${isActiveOnSite ? 'active' : 'inactive'}`}
          aria-label={isActiveOnSite ? 'Active' : 'Inactive'}
        />
      </header>

      {currentCelebration && (
        <section className="bb-celebration" aria-live="polite">
          <span className="bb-celebration-emoji" aria-hidden="true">🎉</span>
          <div className="bb-celebration-body">
            <p className="bb-celebration-label">Milestone unlocked</p>
            <p className="bb-celebration-name">{currentCelebration.name}</p>
          </div>
          <button
            type="button"
            className="bb-celebration-share"
            onClick={() => shareCelebration()}
            aria-label="Download share card"
            title="Download share card"
          >
            ↓
          </button>
          <button
            type="button"
            className="bb-celebration-dismiss"
            onClick={() => void dismissCelebration()}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </section>
      )}

      <section className="bb-status">
        {!state.settings.enabled ? (
          <p className="bb-status-text">BannerBye is off everywhere.</p>
        ) : !state.hostname ? (
          <p className="bb-status-text">No site to act on.</p>
        ) : isSitePaused ? (
          <p className="bb-status-text">
            Paused on <span className="bb-host">{state.hostname}</span>.
          </p>
        ) : (
          <p className="bb-status-text">
            Active on <span className="bb-host">{state.hostname}</span>.
          </p>
        )}
      </section>

      <section className="bb-controls">
        <button
          type="button"
          className={`bb-toggle ${state.settings.enabled ? 'on' : 'off'}`}
          onClick={toggleGlobal}
        >
          <span className="bb-toggle-label">BannerBye</span>
          <span className="bb-toggle-state">
            {state.settings.enabled ? 'On' : 'Off'}
          </span>
        </button>

        {state.hostname && state.settings.enabled && (
          <button
            type="button"
            className="bb-pause"
            onClick={togglePauseSite}
          >
            {isSitePaused ? 'Resume on this site' : 'Pause on this site'}
          </button>
        )}
      </section>

      <section className="bb-stats">
        <span className="bb-stat-number">
          {state.stats.blocked.toLocaleString('en-US')}
        </span>
        <span className="bb-stat-label">banners refused</span>
      </section>

      <section className="bb-milestones">
        <header className="bb-milestones-header">
          <p className="bb-milestones-label">Milestones</p>
          <p className="bb-milestones-count">
            {MILESTONES.filter((m) =>
              state.stats.unlockedMilestones.includes(m.id),
            ).length}
            /{MILESTONES.length}
          </p>
        </header>
        <ul className="bb-milestones-list">
          {MILESTONES.map((m) => {
            const unlocked = state.stats.unlockedMilestones.includes(m.id);
            return (
              <li
                key={m.id}
                className={`bb-milestone ${unlocked ? 'unlocked' : 'locked'}`}
              >
                <span className="bb-milestone-marker" aria-hidden="true">
                  {unlocked ? '✓' : '○'}
                </span>
                <span className="bb-milestone-name">{m.name}</span>
              </li>
            );
          })}
        </ul>
      </section>

      <footer className="bb-footer">
        <button
          type="button"
          className="bb-link"
          onClick={shareStats}
          disabled={state.stats.blocked === 0}
          title={state.stats.blocked === 0 ? 'Refuse a banner first' : 'Download share image of your stats'}
        >
          Share story →
        </button>
        <button
          type="button"
          className="bb-link"
          onClick={reportBrokenSite}
        >
          Report broken site →
        </button>
      </footer>
    </div>
  );
}
