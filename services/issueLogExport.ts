/**
 * services/issueLogExport.ts — one-tap issue-log export, shared by the /owner-logs
 * screen AND the owner auto-prompt (components/OwnerIssueLogPrompt).
 *
 * 2026-06-28 (Tim) — Tank doesn't dig through Owner Tools to export; he needs a
 * "5 issues piled up → tap Send" prompt that just opens the email. This centralizes
 * the body-building + mailto/share so both surfaces format identically (incl. the
 * details line) and both reset the auto-prompt count via markExported().
 */

import { Linking, Platform, Share } from 'react-native';
import { useIssueLogStore, type IssueLogEntry } from '../store/issueLogStore';
import { usePlayerProfileStore } from '../store/playerProfileStore';
import { useSettingsStore } from '../store/settingsStore';
import { getApiBaseUrl, appKeyHeaders } from './apiBase';
import { getInstallId } from './installId';
import { isTestRunner } from './isTestRunner';
import * as Sentry from '@sentry/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// App-key gate → shared appKeyHeaders() (services/apiBase.ts), mirrors api/_appKey.ts on the server.
/**
 * 2026-08-29 — A TEST RUN MUST NOT BE ABLE TO MAIL THE OWNER.
 *
 * On 2026-08-28 twelve "voice_silent_fail: stated_yardage_refused" entries arrived in Tim's inbox
 * as a beta-tester report from install spc-iir7xawq677x, on hole 4, inside 20ms. There was no
 * tester. The values — NaN, ±Infinity, 0, -1, -120, 850, 900, 10000 — are the fixture table of
 * __tests__/regression/stated-yardage-is-a-yardage.test.ts, and `hole 4` is that file's
 * freshRound(). The first version of the setUserStatedYardage guard filed its refusals to the
 * issue log; the store schedules an auto-send on every entry; the suite runs under plain node with
 * real global fetch, shareDiagnostics defaults true and getApiBaseUrl() falls back to the
 * production host. So the tests POSTed to /api/issue-report, and the refusals the suite was
 * PROVING were forwarded as field failures — into Tim's inbox and the Supabase issues table,
 * attributed to an install id that is a test machine.
 *
 * That was fixed at the setter (it logs to console now, see store/roundStore setUserStatedYardage).
 * This is the CLASS fix. The store calls scheduleAutoSend() from seven places covering every entry
 * kind, and ~40 logVoiceSilentFail / logVoiceError call sites sit behind those; the setter was
 * simply the first one a test happened to reach. Nothing about "don't log from that one setter"
 * stops the next guard or the next test from doing it again. [[run-the-second-pass-yourself]]
 * [[no-half-fixes-enforce-every-surface]]
 *
 * The invariant belongs HERE, at the single point where an issue leaves the device: under a test
 * runner, nothing is scheduled and nothing is sent. Evaluated per call rather than at module eval
 * so it cannot be defeated by import ordering. Inert in the app — React Native never sets
 * NODE_ENV=test and has no JEST_WORKER_ID — so this changes no shipped behaviour.
 */
// 2026-09-05 — MOVED to services/isTestRunner so the OTHER sender to this endpoint can reach it.
// It was private here, so services/roundTrace (a second POST to /api/issue-report, written 08-12)
// never got the guard and mailed Tim thirteen fake round traces. One owner, both callers.

const AUTOSEND_DEBOUNCE_MS = 4000;
// 2026-07-30 (audit #17) — cap how long the debounce can keep deferring. A SUSTAINED sub-4s failure
// cadence (e.g. glasses DAT_START_FAILED firing every ~1s — see Tim's issue log) re-armed the 4s timer
// forever, so issues NEVER auto-sent while the failures continued. Once a send has been pending this long,
// fire immediately instead of re-arming.
const AUTOSEND_MAX_WAIT_MS = 20000;
/**
 * 2026-09-06 — PERSISTED, and it has to be.
 *
 * This was an in-memory Set, so it emptied on every app launch and autoSendIssues re-sent every
 * retained entry. That was tolerable while the SERVER was the only consumer — api/issue-report
 * deduped on id and only ever emailed genuinely-new rows. Tonight the client also sends each entry
 * to Sentry as user feedback, and that fires for everything in `unsent` regardless of what the
 * server thinks. So a relaunch became a duplicate storm: Tim got 18 alerts in 8 minutes, five of
 * them at one timestamp, including entries from the day before. I turned a deduped path into a
 * duplicating one; this closes it at the source rather than filtering downstream.
 */
const SENT_IDS_KEY = 'issue-log-sent-ids-v1';
/** Bounded: only recent ids can still be in the retained log, so an unbounded list would grow
 *  forever to prevent resends of entries that no longer exist. */
const SENT_IDS_CAP = 400;
const sentIds = new Set<string>();
let sentIdsHydrated = false;

async function hydrateSentIds(): Promise<void> {
  if (sentIdsHydrated) return;
  sentIdsHydrated = true;   // set first: a failed read must not retry forever
  try {
    const raw = await AsyncStorage.getItem(SENT_IDS_KEY);
    if (!raw) return;
    const list = JSON.parse(raw) as unknown;
    if (Array.isArray(list)) for (const id of list) if (typeof id === 'string') sentIds.add(id);
  } catch { /* a cold start with no memory just re-sends once, which is the old behaviour */ }
}

async function persistSentIds(): Promise<void> {
  try {
    const trimmed = Array.from(sentIds).slice(-SENT_IDS_CAP);
    await AsyncStorage.setItem(SENT_IDS_KEY, JSON.stringify(trimmed));
  } catch { /* best-effort */ }
}
let autoSendTimer: ReturnType<typeof setTimeout> | null = null;
let autoSendFirstArmedAt = 0;

function fmtTs(ms: number): string {
  const d = new Date(ms);
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${date} · ${time}`;
}

function entryBlock(e: IssueLogEntry): string {
  const ctx = e.context;
  const ctxLine = `  [${fmtTs(e.timestamp)} · ${ctx.persona ?? '—'} · ${ctx.route ?? '—'} · ${ctx.isRoundActive ? `hole ${ctx.currentHole ?? '?'} @ ${ctx.courseId ?? '?'}` : 'no round'}]`;
  const detailsLine = e.details && Object.keys(e.details).length > 0
    ? `\n  ${Object.entries(e.details).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' · ')}`
    : '';
  return `• ${e.text}\n${ctxLine}${detailsLine}`;
}

/** Build the full email body (Reporter / Entries / Device + every entry w/ details). */
// 2026-08-10 (Tim — "shut off the non-errors on the issue log"). The store also holds DIAGNOSTIC
// breadcrumbs — every voice turn (voice_turn), the sim-round trace (sim_round), and boot timing (boot).
// Those are for deep owner-log review, NOT issues. What we SEND/EXPORT as an issue report is real
// problems only: actual errors + the tester's own manual notes. (Everything stays in the store; this
// only filters what leaves the device as an "issue".)
const REPORTABLE_KINDS = new Set([
  'user', 'voice_error', 'voice_silent_fail', 'transcribe_error', 'gps_error', 'analysis_error',
  'voice_miss', 'app_error',
]);
function isReportable(e: { kind?: string }): boolean {
  // Legacy entries with no kind are manual user notes → keep.
  return e.kind == null || REPORTABLE_KINDS.has(e.kind);
}

/**
 * 2026-08-29 (Tim, from a 5-entry export where every entry was already fixed) — SEND WHAT IS NEW.
 *
 * This built the body from every retained reportable entry, with no notion of what had already been
 * sent, while `exportAllIssues` set `lastExportedAt` immediately afterwards. So each manual Send
 * re-mailed the whole history: a report arrived carrying a Jul 18 empty-transcript, an Aug 7 crash
 * fixed on Aug 9, and an Aug 28 TTS drop fixed that afternoon — three closed defects reading as a
 * live pile, and the genuinely new entry indistinguishable among them.
 *
 * `OwnerIssueLogPrompt` was already counting the right thing (`timestamp > lastExportedAt`) to
 * decide when to nudge — it said "5 piled up" and then sent forty. The number the tester is shown
 * and the payload they send are now the same set.
 *
 * Nothing is deleted or hidden: the full log stays on the device and in /owner-logs, and a first
 * export (lastExportedAt 0) still sends everything.
 */
export function buildIssueLogBody(): { subject: string; body: string; count: number } {
  const { entries: all, lastExportedAt } = useIssueLogStore.getState();
  const entries = all.filter(e => isReportable(e) && e.timestamp > (lastExportedAt ?? 0));
  const reporter = usePlayerProfileStore.getState().email || 'beta tester';
  const text = entries.map(entryBlock).join('\n\n');
  const subject = `SmartPlay Caddie issue log — ${reporter}`;
  const body = `Reporter: ${reporter}\nEntries: ${entries.length}\nDevice: ${Platform.OS}\n\n${text}\n\n— Sent from SmartPlay Caddie Issue Log`;
  return { subject, body, count: entries.length };
}

/**
 * 2026-07-23 — Consented auto-send: push unsent issue entries to /api/issue-report so the team sees
 * them centrally without the tester tapping "Send". Debounced + deduped by entry id. Best-effort; never
 * throws, never blocks. The mailto export below stays as the explicit manual action.
 * 2026-07-26 (deep audit S3) — this ships the tester's EMAIL + diagnostics, so it's gated on the SEPARATE
 * `shareDiagnostics` consent (was `shareCommunityData`, which is really about course-map coords) so PII
 * no longer rides the course-sharing toggle silently.
 */
export function scheduleIssueAutoSend(): void {
  // A test run never arms the timer — see isTestRunner() above.
  if (isTestRunner()) return;
  if (useSettingsStore.getState().shareDiagnostics === false) return;
  const now = Date.now();
  if (!autoSendTimer) autoSendFirstArmedAt = now;
  // Been deferring under a sustained failure cadence past the cap → flush now instead of re-arming.
  if (autoSendTimer && now - autoSendFirstArmedAt >= AUTOSEND_MAX_WAIT_MS) {
    clearTimeout(autoSendTimer); autoSendTimer = null; autoSendFirstArmedAt = 0;
    void autoSendIssues();
    return;
  }
  if (autoSendTimer) clearTimeout(autoSendTimer);
  autoSendTimer = setTimeout(() => { autoSendTimer = null; autoSendFirstArmedAt = 0; void autoSendIssues(); }, AUTOSEND_DEBOUNCE_MS);
}

/**
 * Compose the feedback body without losing a structured `details`.
 *
 * A string rides through untouched; anything else is JSON so the round trace survives. An
 * unserialisable value (a cycle) degrades to the text alone rather than throwing away the report.
 */
function renderDetails(text: string, details: unknown): string {
  if (details == null) return text;
  if (typeof details === 'string') return `${text}\n\n${details}`;
  try { return `${text}\n\n${JSON.stringify(details, null, 2)}`; } catch { return text; }
}

/**
 * 2026-09-09 (72-hour triple-check) — ONE SEND AT A TIME, which "one event, one alert" assumed and
 * never enforced.
 *
 * `ed15ed2b` fixed the storm Tim got on 09-06 by persisting `sentIds` — correct, and not sufficient,
 * because ids are only added AFTER the POST resolves. Nothing stopped a second call entering while
 * the first was still in flight, and there are two independent triggers: `app/_layout.tsx` fires one
 * on mount, and `scheduleIssueAutoSend` fires from seven store call sites behind ~40 log sites, on a
 * 4s debounce with a 20s max-wait FLUSH that bypasses the debounce entirely.
 *
 * A POST that takes longer than the debounce — a cold Lambda, a bad cell signal, exactly the
 * conditions that produce issues worth sending — means the second call recomputes `unsent` from an
 * unchanged `sentIds`, sends the same rows again, and files a second Sentry feedback for each. The
 * duplicate storm this commit set out to end, reachable on any slow network.
 *
 * `hydrateSentIds` had the same shape one level down: it sets its flag BEFORE awaiting storage
 * (deliberately, so a failed read cannot retry forever), so a caller arriving during that await saw
 * an empty `sentIds` and treated every retained entry as unsent. That is the same check-then-act
 * across an await that `27633173` fixed in the media path the very next morning.
 *
 * Coalescing fixes both at once: a concurrent caller gets the in-flight send's result rather than
 * starting a competing one. Entries that arrive DURING a send are not lost — the store's own
 * scheduler re-arms for them, and the trailing check below covers the case where it already fired.
 */
let inFlightSend: Promise<boolean> | null = null;

export async function autoSendIssues(): Promise<boolean> {
  if (inFlightSend) return inFlightSend;
  inFlightSend = autoSendIssuesInner();
  try {
    return await inFlightSend;
  } finally {
    inFlightSend = null;
  }
}

async function autoSendIssuesInner(): Promise<boolean> {
  // ...and never sends, even if something calls it directly.
  if (isTestRunner()) return false;
  if (useSettingsStore.getState().shareDiagnostics === false) return false;
  const base = getApiBaseUrl();
  if (!base) return false;
  const reporter = usePlayerProfileStore.getState().email || 'beta tester';
  // 2026-08-10 — only real errors + manual notes auto-send; the voice_turn / sim_round / boot
  // breadcrumbs stay device-side for owner-log review and never clutter the issue email.
  await hydrateSentIds();
  const unsent = useIssueLogStore.getState().entries.filter(e => !sentIds.has(e.id) && isReportable(e));
  if (unsent.length === 0) return false;
  /**
   * 2026-08-13 — attach the anonymous install id HERE, at the single send point, rather than at each
   * of the ~10 places that write an issue entry. One place to be right, and every entry carries it
   * whichever subsystem logged it.
   *
   * It rides inside `context` deliberately: that is already a JSON column server-side, so this needs
   * no migration and cannot break the insert. The reporting path was verified working end-to-end today
   * and is not worth risking for a field.
   */
  const installId = await getInstallId();
  const payload = {
    entries: unsent.map(e => ({
      id: e.id,
      text: e.text,
      reporter,
      platform: Platform.OS,
      context: installId
        ? { ...(e.context && typeof e.context === 'object' ? e.context : {}), installId }
        : e.context,
      details: e.details ?? null,
      timestamp: e.timestamp,
    })),
  };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(`${base.replace(/\/+$/, '')}/api/issue-report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...appKeyHeaders() },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      for (const e of unsent) sentIds.add(e.id);
      void persistSentIds();
      /**
       * 2026-09-06 (Tim — the issue log and Sentry should be ONE system, not two inboxes).
       *
       * The same entries now also go to Sentry as user feedback, so a crash Sentry caught on its own
       * and a tester's note about that same crash land in one fingerprint space with one dedupe.
       * Before this they could not meet: the crash was in Sentry, the note was in an email.
       *
       * Sent AFTER the POST succeeds and inside the ok-branch on purpose — Supabase stays the
       * durable record, and a Sentry outage must not cost us the entry. Each call is individually
       * guarded because captureFeedback is fire-and-forget telemetry and must never be able to fail
       * a send that already succeeded.
       */
      for (const e of unsent) {
        /**
         * 2026-09-06 — DO NOT SEND A CRASH AS FEEDBACK. Sentry's own global handler already captured
         * `uncaught_js_error` as a fatal EXCEPTION, with a real stack. Sending the issue-log copy as
         * user feedback puts the same crash in the project twice under two different shapes — which
         * is exactly what Tim saw: "Error anonymous(index.android)" at 11:32:07 and
         * "User Feedback: SmartPlay owner test e..." at 11:32:50, one event, two entries.
         *
         * The whole reason to merge the log into Sentry was ONE fingerprint space. Duplicating the
         * events we already had there would undo that on the first crash.
         */
        if (e.kind === 'app_error') continue;
        try {
          const ctx = (e.context && typeof e.context === 'object' ? e.context : {}) as Record<string, unknown>;
          Sentry.captureFeedback({
            /**
             * 2026-09-06 — `details` is typed loose and IS an object on the round-trace path
             * (`details: { trace: body }`). Template-interpolating it yields "[object Object]" and
             * silently loses the trace — the exact regression
             * the-issue-inbox-carries-only-real-issues.test.ts was written for, which is how this
             * was caught. Stringify a non-string; never interpolate it.
             */
            message: renderDetails(e.text, e.details),
            name: reporter,
            source: 'issue-log',
            tags: {
              install_id: installId ?? 'unknown',
              platform: Platform.OS,
              // The round context the triage side needs to reproduce: which course, which hole,
              // mid-round or not. Already on every entry — this just carries it across.
              course_id: String(ctx.courseId ?? 'none'),
              hole: String(ctx.currentHole ?? 'none'),
              round_active: String(ctx.isRoundActive ?? false),
              route: String(ctx.route ?? 'unknown'),
              app_version: String(ctx.appVersion ?? 'unknown'),
            },
          });
        } catch { /* telemetry only; the entry is already stored server-side */ }
      }
      console.log('[issueLogExport] auto-sent', unsent.length, 'issues');
      return true;
    }
    return false;
  } catch (e) {
    console.log('[issueLogExport] auto-send failed (non-fatal):', e instanceof Error ? e.message : String(e));
    return false;
  }
}

/**
 * One-tap export: open the mail client pre-filled to support@ (or the share sheet
 * if no mail app), then mark the log exported so the auto-prompt count resets.
 *
 * 2026-08-29 — returns a STATUS rather than a boolean. Once the body only carries what is new,
 * "there is nothing new to send" became a normal outcome, and the caller was showing it as
 * "Export failed" — telling a tester something broke when the truth is everything already went.
 */
export async function exportAllIssues(): Promise<'sent' | 'nothing_new' | 'failed'> {
  const { subject, body, count } = buildIssueLogBody();
  if (count === 0) return 'nothing_new';
  const mailto = `mailto:tim@smartplaycaddie.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  try {
    if (await Linking.canOpenURL(mailto).catch(() => false)) {
      await Linking.openURL(mailto);
    } else {
      await Share.share({ message: `tim@smartplaycaddie.com\n\n${body}`, title: subject });
    }
    useIssueLogStore.getState().markExported();
    return 'sent';
  } catch {
    return 'failed';
  }
}
