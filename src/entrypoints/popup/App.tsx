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
  addReportedSite,
  clearPendingReportFixed,
  getRecentActivity,
  clearActivity,
  markReviewAskDone,
} from '@/lib/storage';
import { isHostPaused, normalizeHost } from '@/lib/host';
import { getMilestoneById, MILESTONES, type Milestone } from '@/lib/milestones';
import { downloadShareCard, downloadStatsCard } from '@/lib/share-card';
import { t } from '@/lib/i18n/t';
import type {
  ActivityEntry,
  LocalStats,
  SyncedSettings,
} from '@/lib/types';

const REPORT_ENDPOINT = 'https://bannerbye.com/api/report';

/**
 * v0.2.1: review-link in de footer (ASO — reviews aanjagen).
 * Per browser de juiste store-reviewpagina. Pas zichtbaar vanaf
 * REVIEW_THRESHOLD geblokkeerde banners: we vragen alleen op het
 * moment dat de extensie zich bewezen heeft. Geen prompt, geen
 * nag — één stille link. (Anti-feature manifest: no pressure.)
 */
const REVIEW_URLS: Record<string, string> = {
  chrome:
    'https://chromewebstore.google.com/detail/gjeafgcfhehafjioplpjkocbglmhhbfg/reviews',
  firefox: 'https://addons.mozilla.org/firefox/addon/bannerbye/reviews/',
  safari: 'https://apps.apple.com/app/id6771131989?action=write-review',
};
// Zelfde cast als tcf.content.ts — wxt's ImportMeta-typing dekt `env` hier niet.
const REVIEW_URL =
  REVIEW_URLS[
    (import.meta as unknown as { env: { BROWSER: string } }).env.BROWSER
  ] ?? REVIEW_URLS.chrome!;
const REVIEW_THRESHOLD = 100;

/**
 * v0.4.0: de éne actieve review-vraag die het anti-feature manifest toestaat.
 * Verschijnt precies één keer, direct na het wegklikken van een milestone-
 * viering — het moment waarop de extensie zich net bewezen heeft. Wegklikken
 * of doorklikken = klaar, voor altijd (reviewAskDone in storage). Niet bij de
 * allereerste milestones: pas vanaf 100 banners of een dag-milestone.
 */
function milestoneWarrantsReviewAsk(m: Milestone): boolean {
  return m.threshold.type === 'days' || m.threshold.count >= REVIEW_THRESHOLD;
}

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
    /** v0.3.0: optioneel e-mailadres om een seintje te krijgen bij een fix. */
    email: string;
    status: ReportStatus;
    errorText: string;
  } | null;
  /** v0.4.0: recente activiteit per host — het bewijs onder de teller. */
  activity: ActivityEntry[];
  /** v0.4.0: staat het bewijs-paneel open? Dicht bij openen van de popup. */
  activityOpen: boolean;
  /** v0.4.0: toon de eenmalige review-vraag (na dismiss van een viering). */
  reviewAsk: boolean;
}

/** "3 min ago" / "2 days ago" — kort en zonder bibliotheek. */
function timeAgo(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return t('popup_time_just_now');
  if (mins < 60) return t('popup_time_minutes_ago', String(mins));
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t('popup_time_hours_ago', String(hours));
  const days = Math.floor(hours / 24);
  return days === 1
    ? t('popup_time_one_day_ago')
    : t('popup_time_days_ago', String(days));
}

/** Losse, tolerante e-mailcheck — alleen om onzin te weren, niet streng. */
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

async function getActiveTabHost(): Promise<string | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return null;
  return normalizeHost(tab.url);
}

export function App() {
  const [state, setState] = useState<PopupState>({
    settings: { enabled: true, pausedSites: [], onboardingCompleted: false },
    stats: {
      blocked: 0,
      installedAt: 0,
      unlockedMilestones: [],
      pendingCelebrations: [],
      reportedSites: [],
      pendingReportFixed: [],
      recentActivity: [],
      reviewAskDone: false,
    },
    hostname: null,
    loading: true,
    reportModal: null,
    activity: [],
    activityOpen: false,
    reviewAsk: false,
  });

  useEffect(() => {
    void (async () => {
      const [settings, stats, hostname, activity] = await Promise.all([
        getSettings(),
        getStats(),
        getActiveTabHost(),
        getRecentActivity(),
      ]);
      setState({
        settings,
        stats,
        hostname,
        loading: false,
        reportModal: null,
        activity,
        activityOpen: false,
        reviewAsk: false,
      });
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

  /** v0.4.0: bewijs-paneel open/dicht. Puur lokale UI-state, niets opgeslagen. */
  function toggleActivity() {
    setState((s) => ({ ...s, activityOpen: !s.activityOpen }));
  }

  /** v0.4.0: wis de activiteitenlijst. De teller blijft staan — dat is een
   * ander gegeven (wat BannerBye deed vs. waar het dat deed). */
  async function wipeActivity() {
    const nextStats = await clearActivity();
    setState((s) => ({ ...s, stats: nextStats, activity: [] }));
  }

  /** Eerste in pendingCelebrations → toon als card. Lookup via stable id. */
  const firstPendingId = state.stats.pendingCelebrations[0];
  const currentCelebration: Milestone | null =
    firstPendingId !== undefined
      ? (getMilestoneById(firstPendingId) ?? null)
      : null;

  async function dismissCelebration() {
    if (!currentCelebration) return;
    // v0.4.0: dít is het enige moment waarop de eenmalige review-vraag mag
    // verschijnen — direct na een viering, en alleen als hij nooit eerder is
    // afgehandeld en de milestone zwaar genoeg is (anti-feature manifest).
    const showReviewAsk =
      !state.stats.reviewAskDone &&
      milestoneWarrantsReviewAsk(currentCelebration);
    const nextStats = await clearPendingCelebration(currentCelebration.id);
    setState((s) => ({
      ...s,
      stats: nextStats,
      reviewAsk: s.reviewAsk || showReviewAsk,
    }));
    // Geen handmatige badge-clear meer hier — chrome.storage.local.set
    // in clearPendingCelebration triggert background.onChanged → syncRankBadge,
    // dat de "🎉" vervangt door het persistente rang-getal (#85).
  }

  /** v0.4.0: review-vraag weggeklikt — markeer definitief afgehandeld. */
  async function dismissReviewAsk() {
    const nextStats = await markReviewAskDone();
    setState((s) => ({ ...s, stats: nextStats, reviewAsk: false }));
  }

  /** v0.4.0: doorgeklikt naar de store — ook definitief afgehandeld. */
  function acceptReviewAsk() {
    void markReviewAskDone();
    openReview();
  }

  /**
   * #reward-1: eerste host in pendingReportFixed → toon de "jouw melding is nu
   * gekild"-card. Losstaand van milestone-celebrations.
   */
  const currentReportFixed: string | null =
    state.stats.pendingReportFixed[0] ?? null;

  async function dismissReportFixed() {
    if (!currentReportFixed) return;
    const nextStats = await clearPendingReportFixed(currentReportFixed);
    setState((s) => ({ ...s, stats: nextStats }));
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
        email: '',
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

  function updateReportEmail(email: string) {
    setState((s) => ({
      ...s,
      reportModal: s.reportModal ? { ...s.reportModal, email } : null,
    }));
  }

  async function sendReport() {
    if (!state.reportModal) return;
    const { hostname, message, email } = state.reportModal;
    // Alleen een plausibel e-mailadres meesturen; leeg = volledig anoniem.
    const trimmedEmail = email.trim();
    const emailToSend = looksLikeEmail(trimmedEmail) ? trimmedEmail : '';
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
          ...(emailToSend ? { email: emailToSend } : {}),
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      // #reward-1: onthoud lokaal dat we deze host meldden, zodat we later
      // kunnen vieren wanneer BannerBye er alsnog een banner blokkeert.
      void addReportedSite(hostname);
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

  /** Opent de store-reviewpagina in een nieuw tabblad en sluit de popup. */
  function openReview() {
    void chrome.tabs.create({ url: REVIEW_URL });
    window.close();
  }

  if (state.loading) {
    return <div className="bb-loading">{t('popup_loading')}</div>;
  }

  return (
    <div className="bb-popup">
      {state.reportModal && (
        <div className="bb-modal-overlay" onClick={closeReportModal}>
          <div
            className="bb-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label={t('popup_modal_title')}
          >
            <header className="bb-modal-header">
              <p className="bb-modal-title">{t('popup_modal_title')}</p>
              <button
                type="button"
                className="bb-modal-close"
                onClick={closeReportModal}
                aria-label={t('popup_modal_close_aria')}
              >
                ✕
              </button>
            </header>

            {state.reportModal.status === 'sent' ? (
              <p className="bb-modal-sent">
                {t('popup_modal_sent', state.reportModal.hostname)}
              </p>
            ) : (
              <>
                <p className="bb-modal-help">
                  {t('popup_modal_help', state.reportModal.hostname)}
                </p>
                <textarea
                  className="bb-modal-textarea"
                  placeholder={t('popup_modal_placeholder_message')}
                  value={state.reportModal.message}
                  onChange={(e) => updateReportMessage(e.target.value)}
                  rows={4}
                  maxLength={2000}
                  disabled={state.reportModal.status === 'sending'}
                />
                <input
                  className="bb-modal-input"
                  type="email"
                  placeholder={t('popup_modal_placeholder_email')}
                  value={state.reportModal.email}
                  onChange={(e) => updateReportEmail(e.target.value)}
                  maxLength={254}
                  autoComplete="email"
                  disabled={state.reportModal.status === 'sending'}
                />
                <p className="bb-modal-fineprint">
                  {t('popup_modal_fineprint')}
                </p>
                {state.reportModal.status === 'error' && (
                  <p className="bb-modal-error">
                    {t('popup_modal_error', state.reportModal.errorText)}
                  </p>
                )}
                <button
                  type="button"
                  className="bb-modal-copy"
                  onClick={() => void sendReport()}
                  disabled={state.reportModal.status === 'sending'}
                >
                  {state.reportModal.status === 'sending'
                    ? t('popup_modal_sending')
                    : state.reportModal.status === 'error'
                      ? t('popup_modal_try_again')
                      : t('popup_modal_send')}
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
          aria-label={
            isActiveOnSite
              ? t('popup_status_dot_active_aria')
              : t('popup_status_dot_inactive_aria')
          }
        />
      </header>

      {currentCelebration && (
        <section className="bb-celebration" aria-live="polite">
          <span className="bb-celebration-emoji" aria-hidden="true">🎉</span>
          <div className="bb-celebration-body">
            <p className="bb-celebration-label">{t('popup_celebration_label')}</p>
            <p className="bb-celebration-name">{t(currentCelebration.nameKey)}</p>
          </div>
          <button
            type="button"
            className="bb-celebration-share"
            onClick={() => shareCelebration()}
            aria-label={t('popup_celebration_share_aria')}
            title={t('popup_celebration_share_aria')}
          >
            ↓
          </button>
          <button
            type="button"
            className="bb-celebration-dismiss"
            onClick={() => void dismissCelebration()}
            aria-label={t('popup_celebration_dismiss_aria')}
          >
            ✕
          </button>
        </section>
      )}

      {currentReportFixed && (
        <section className="bb-celebration bb-celebration-fixed" aria-live="polite">
          <span className="bb-celebration-emoji" aria-hidden="true">✓</span>
          <div className="bb-celebration-body">
            <p className="bb-celebration-label">{t('popup_reportfixed_label')}</p>
            <p className="bb-celebration-name">
              {t('popup_reportfixed_text', currentReportFixed)}
            </p>
          </div>
          <button
            type="button"
            className="bb-celebration-dismiss"
            onClick={() => void dismissReportFixed()}
            aria-label={t('popup_celebration_dismiss_aria')}
          >
            ✕
          </button>
        </section>
      )}

      {state.reviewAsk && !currentCelebration && (
        <section className="bb-celebration bb-celebration-review" aria-live="polite">
          <span className="bb-celebration-emoji" aria-hidden="true">★</span>
          <div className="bb-celebration-body">
            <p className="bb-celebration-label">{t('popup_reviewask_label')}</p>
            <p className="bb-celebration-name">{t('popup_reviewask_title')}</p>
            <p className="bb-review-text">{t('popup_reviewask_text')}</p>
            <button
              type="button"
              className="bb-review-cta"
              onClick={acceptReviewAsk}
            >
              {t('popup_reviewask_cta')}
            </button>
          </div>
          <button
            type="button"
            className="bb-celebration-dismiss"
            onClick={() => void dismissReviewAsk()}
            aria-label={t('popup_reviewask_dismiss_aria')}
            title={t('popup_reviewask_dismiss_title')}
          >
            ✕
          </button>
        </section>
      )}

      <section className="bb-status">
        {!state.settings.enabled ? (
          <p className="bb-status-text">{t('popup_status_off')}</p>
        ) : !state.hostname ? (
          <p className="bb-status-text">{t('popup_status_no_site')}</p>
        ) : isSitePaused ? (
          <p className="bb-status-text">
            {t('popup_status_paused', state.hostname)}
          </p>
        ) : (
          <p className="bb-status-text">
            {t('popup_status_active', state.hostname)}
          </p>
        )}
      </section>

      <section className="bb-controls">
        <button
          type="button"
          className={`bb-toggle ${state.settings.enabled ? 'on' : 'off'}`}
          onClick={toggleGlobal}
        >
          <span className="bb-toggle-label">{t('popup_toggle_label')}</span>
          <span className="bb-toggle-state">
            {state.settings.enabled ? t('popup_toggle_on') : t('popup_toggle_off')}
          </span>
        </button>

        {state.hostname && state.settings.enabled && (
          <button
            type="button"
            className="bb-pause"
            onClick={togglePauseSite}
          >
            {isSitePaused ? t('popup_resume_site') : t('popup_pause_site')}
          </button>
        )}
      </section>

      <section className="bb-stats">
        <span className="bb-stat-number">
          {state.stats.blocked.toLocaleString('en-US')}
        </span>
        <span className="bb-stat-label">{t('popup_stat_label')}</span>

        {state.activity.length > 0 && (
          <>
            <button
              type="button"
              className="bb-activity-toggle"
              onClick={toggleActivity}
              aria-expanded={state.activityOpen}
              aria-controls="bb-activity-panel"
            >
              <span className="bb-activity-caret" aria-hidden="true">
                {state.activityOpen ? '▾' : '▸'}
              </span>
              {state.activityOpen
                ? t('popup_activity_hide')
                : t('popup_activity_show')}
            </button>

            {state.activityOpen && (
              <div id="bb-activity-panel" className="bb-activity">
                <ul className="bb-activity-list">
                  {state.activity.map((entry) => (
                    <li key={entry.host} className="bb-activity-row">
                      <span
                        className={`bb-activity-mark ${entry.outcome}`}
                        aria-hidden="true"
                      >
                        {entry.outcome === 'refused' ? '✕' : '·'}
                      </span>
                      <span className="bb-activity-host" title={entry.host}>
                        {entry.host}
                      </span>
                      <span className="bb-activity-meta">
                        {entry.outcome === 'refused'
                          ? (entry.platform ?? t('popup_activity_banner_refused_fallback'))
                          : t('popup_activity_no_banner')}
                        {entry.count > 1
                          ? t('popup_activity_count_suffix', String(entry.count))
                          : ''}
                      </span>
                      <span className="bb-activity-time">
                        {timeAgo(entry.lastAt)}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="bb-activity-note">{t('popup_activity_note')}</p>
                <button
                  type="button"
                  className="bb-activity-clear"
                  onClick={wipeActivity}
                >
                  {t('popup_activity_clear')}
                </button>
              </div>
            )}
          </>
        )}
      </section>

      <section className="bb-milestones">
        <header className="bb-milestones-header">
          <p className="bb-milestones-label">{t('popup_milestones_label')}</p>
          <p className="bb-milestones-count">
            {t('popup_milestones_count', [
              String(
                MILESTONES.filter((m) =>
                  state.stats.unlockedMilestones.includes(m.id),
                ).length,
              ),
              String(MILESTONES.length),
            ])}
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
                <span className="bb-milestone-name">{t(m.nameKey)}</span>
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
          title={
            state.stats.blocked === 0
              ? t('popup_footer_download_stats_disabled_title')
              : t('popup_footer_download_stats_title')
          }
        >
          {t('popup_footer_download_stats')}
        </button>
        <button
          type="button"
          className="bb-link"
          onClick={reportBrokenSite}
        >
          {t('popup_footer_report')}
        </button>
        {state.stats.blocked >= REVIEW_THRESHOLD && (
          <button
            type="button"
            className="bb-link"
            onClick={openReview}
            title={t('popup_footer_rate_title')}
          >
            {t('popup_footer_rate')}
          </button>
        )}
      </footer>
    </div>
  );
}
