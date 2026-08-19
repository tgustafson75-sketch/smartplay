/**
 * Issue log — on-device diagnostics for EVERY tester (was owner-only through 2026-07).
 *
 * 2026-05-17 — Tim asked: "is it possible with only my login that I
 * can talk to Kevin about issues with the app and then they are
 * stored somewhere so that when we come back to this, we can review
 * that file?... a real time IT assistant in the background would
 * make testing pretty powerful."
 *
 * Implementation: a separate Zustand store keyed by entry id. Persisted
 * to AsyncStorage so entries survive app restarts. Capped at 100
 * entries (FIFO) so a runaway debug session can't bloat storage.
 *
 * Entries are written by the voice intent `log_issue` (handler picks up
 * "Kevin, log this..." / "log an issue..." / "I have feedback..." and
 * captures the rest of the utterance as the note) AND by every failure
 * path (voice/GPS/analysis/app errors + voice misses). Settings exposes
 * an "Owner Logs" surface for Tim to review + copy + clear.
 *
 * 2026-07-30 (beta wrap — Tim: "make sure users' apps are RECORDING and PROMPTING
 * to send issue logs") — the log is no longer owner-only. A recorded FAILURE now
 * schedules the consented auto-send itself (see scheduleAutoSend below), so a
 * tester's crash/voice/GPS error reaches the team without them voicing "log an
 * issue"; and addUserIssue is un-gated so a tester's spoken bug report persists.
 * Only high-volume owner traces (voice_turn conversation logging, sim_round) stay
 * owner-scoped / excluded from auto-send to avoid flooding a tester's 100-entry log.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getPersistStorage } from '../services/ssrSafeStorage';

// 2026-06-04 — Voice diagnostics surface. Kind defaults to 'user' for
// the original "Kevin, log this..." entries. Voice failure paths use
// the structured kinds so /owner-logs can filter to a Voice tab and
// show speak/transcribe/kevin errors without an ADB cable.
export type IssueLogKind =
  | 'user'
  /**
   * 2026-08-19 (beta tester report — Tim received an "analysis_error: swing_located" email for a
   * swing the app had located PERFECTLY WELL: 5.1s, window 2.6–8.1, confidence low).
   *
   * `addAppEvent` defaults its kind to 'analysis_error', and the pose locator's breadcrumbs pass no
   * kind — so its SUCCESS lines were classified as errors and, because 'analysis_error' is
   * reportable, auto-forwarded to the owner inbox. The 08-10 note on REPORTABLE_KINDS says exactly
   * what that list is for: "what we SEND/EXPORT as an issue report is real problems only."
   *
   * 'diag' is the kind for an event worth KEEPING on the device and worth nothing in an inbox: the
   * happy path, and paths deliberately skipped by design. Everything stays in the store for owner-log
   * review; it simply stops being mailed out as a problem. A release inbox is only useful if every
   * line in it is a line worth reading — successes buried the real errors this week.
   */
  | 'diag'
  // 2026-07-04 (Tim — "when I run the sim round, does it go to a log so you can
  // review the output?") — every sim-round event (start, narrated moves, tee
  // jumps, end) persists here so the post-run export carries the full trace.
  | 'sim_round'
  | 'voice_error'
  | 'voice_silent_fail'
  | 'transcribe_error'
  // 2026-06-08 — GPS / signal failures auto-log here so a field tester can
  // review + export them after a round without an ADB cable.
  | 'gps_error'
  // 2026-06-10 — Analysis / frame-extraction failures (swing-analysis, pose,
  // putt) + any other app failure auto-log here so re-analyze / SmartMotion
  // issues are diagnosable in the field (e.g. "frame_extraction_empty" with the
  // clip uri scheme + per-frame errors reveals an Android codec/VFR problem).
  | 'analysis_error'
  // 2026-06-26 (Tim — "everything that doesn't go as planned needs to go as an
  // error to the issue log") — voice command misses (classifier_unknown /
  // no_handler / handler_error) now mirror into the issue log, not just the
  // separate voice-misses store.
  | 'voice_miss'
  | 'app_error'
  // 2026-06-30 (Tim — "a log for the WHOLE voice") — every voice turn: what he said +
  // what the caddie replied (or null). Successes AND misses, so the full conversation is
  // reviewable in owner logs to tune the narrative brain.
  | 'voice_turn'
  // 2026-06-28 (Tim) — TEMPORARY boot-timing breadcrumbs (services/bootTrace.ts):
  // bundle-load → mount → hydrate → warmup → triggers, timestamped, so the first
  // transcribe failure can be placed on the startup timeline. Owner-only.
  | 'boot';

export interface IssueLogEntry {
  /** Stable id: `${timestamp}_${random}`. */
  id: string;
  /** ms-since-epoch when the user spoke / typed the entry. */
  timestamp: number;
  /** The actual note text. From voice: the user's full utterance with
   *  the wake phrase stripped. From manual: the typed text verbatim.
   *  For voice events: a one-line summary built from stage+errorMessage. */
  text: string;
  /** Entry classification. Undefined = legacy 'user' entry. */
  kind?: IssueLogKind;
  /** Voice events only: which stage in the pipeline failed (e.g.
   *  'speak_preempted_after_fetch', 'transcribe_http', 'brain_catch'). */
  stage?: string;
  /** Voice events only: extra diagnostic fields (speechId, http status,
   *  truncated server body, etc.). */
  details?: Record<string, unknown>;
  /** Context snapshot at capture time. Helps later diagnosis without
   *  having to ask the user "where were you when you saw this?". */
  context: {
    route: string | null;
    persona: string | null;
    isRoundActive: boolean;
    courseId: string | null;
    currentHole: number | null;
    appVersion: string;
  };
}

interface IssueLogState {
  entries: IssueLogEntry[];
  /** When the log was last exported/emailed. Drives the owner auto-prompt: failures
   *  newer than this are "unsent". 0 = never exported. */
  lastExportedAt: number;
  /** Mark the log exported (resets the owner auto-prompt's unsent count). */
  markExported: () => void;
  addEntry: (text: string, context: IssueLogEntry['context']) => void;
  /** Structured voice-pipeline event entry. Skips the wake-phrase /
   *  trimmed-text path; builds a one-line summary from stage + details. */
  addVoiceEvent: (
    kind: Exclude<IssueLogKind, 'user'>,
    stage: string,
    context: IssueLogEntry['context'],
    details?: Record<string, unknown>,
  ) => void;
  /** GPS / signal failure auto-log. Builds its own context snapshot so
   *  low-level services (gpsManager) can call it without threading route/
   *  persona. Best-effort: never throws. */
  addGpsEvent: (stage: string, details?: Record<string, unknown>) => void;
  /** TEMPORARY boot-timing breadcrumb (services/bootTrace.ts). Owner-gated upstream. */
  addBootEvent: (stage: string, details?: Record<string, unknown>) => void;
  /** Analysis / frame-extraction / any-other-failure auto-log. Self-context
   *  like addGpsEvent so low-level services can call it freely. `kind` defaults
   *  to 'analysis_error'; pass 'app_error' for non-analysis failures. */
  addAppEvent: (
    stage: string,
    details?: Record<string, unknown>,
    kind?: 'analysis_error' | 'app_error' | 'sim_round' | 'diag',
  ) => void;
  /** Voice "log this issue" → a real user entry (ANY tester; un-gated 2026-07-30). Self-builds
   *  context + schedules the consented auto-send so the brain tool handler can call it directly. */
  addUserIssue: (text: string) => void;
  /** Voice command miss (classifier_unknown / no_handler / handler_error) mirrored
   *  into the issue log as an error. Self-builds context. */
  addVoiceMiss: (missType: string, details?: Record<string, unknown>) => void;
  /** 2026-06-30 — log ONE full voice turn: the transcript + the caddie's reply (null if
   *  none) + optional meta (tool fired, path, provider). Owner-only, best-effort. */
  addVoiceTurn: (transcript: string, response: string | null, meta?: Record<string, unknown>) => void;
  clearAll: () => void;
  remove: (id: string) => void;
}

const MAX_ENTRIES = 100;

/** 2026-07-30 (issue-log audit SEV-2) — schedule the consented auto-send after a FAILURE is
 *  recorded, so a tester's crash/voice/GPS/analysis error reaches /api/issue-report WITHOUT
 *  them having to voice "log an issue". Debounced + consent-gated (shareDiagnostics) inside
 *  scheduleIssueAutoSend → autoSendIssues. Lazy require breaks the import cycle (issueLogExport
 *  imports this store). Best-effort; never throws. */
function scheduleAutoSend(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('../services/issueLogExport') as typeof import('../services/issueLogExport')).scheduleIssueAutoSend();
  } catch { /* auto-send is optional */ }
}

/** Best-effort context snapshot via lazy requires (mirrors addGpsEvent/addAppEvent)
 *  so callers don't thread route/persona/round and we avoid module-eval cycles. */
function selfContext(route: string): IssueLogEntry['context'] {
  let appVersion = '1.0.0';
  let persona: string | null = null;
  let isRoundActive = false;
  let courseId: string | null = null;
  let currentHole: number | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const round = require('./roundStore').useRoundStore.getState();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const settings = require('./settingsStore').useSettingsStore.getState();
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      appVersion = require('expo-constants').default?.expoConfig?.version ?? '1.0.0';
    } catch { /* keep default */ }
    persona = settings?.caddiePersonality ?? null;
    isRoundActive = !!round?.isRoundActive;
    courseId = round?.activeCourseId ?? null;
    currentHole = round?.currentHole ?? null;
  } catch { /* best-effort */ }
  // 2026-07-29 (Tim — "show the crash log route") — prefer the LIVE navigation route from the
  // breadcrumb tracker so every entry shows the actual screen; the passed label is a coarse fallback.
  let liveRoute: string | null = null;
  try { liveRoute = require('../services/routeBreadcrumb').getRoute() ?? null; } catch { /* tracker absent */ }
  return { route: liveRoute ?? route, persona, isRoundActive, courseId, currentHole, appVersion };
}

export const useIssueLogStore = create<IssueLogState>()(
  persist(
    (set) => ({
      entries: [],
      lastExportedAt: 0,
      markExported: () => set({ lastExportedAt: Date.now() }),
      addEntry: (text, context) => {
        const trimmed = text.trim();
        if (!trimmed) return;
        const entry: IssueLogEntry = {
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          timestamp: Date.now(),
          text: trimmed,
          kind: 'user',
          context,
        };
        set(s => ({ entries: [entry, ...s.entries].slice(0, MAX_ENTRIES) }));
        console.log('[issueLog] new entry:', trimmed.slice(0, 80));
        // 2026-07-23 — consented auto-send of USER-reported issues (not diagnostic traces).
        scheduleAutoSend();
      },
      addVoiceEvent: (kind, stage, context, details) => {
        const errorMessage =
          typeof details?.error === 'string'
            ? details.error
            : details?.error != null
              ? String(details.error)
              : null;
        const summary = errorMessage
          ? `${kind}: ${stage} — ${errorMessage.slice(0, 200)}`
          : `${kind}: ${stage}`;
        const entry: IssueLogEntry = {
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          timestamp: Date.now(),
          text: summary,
          kind,
          stage,
          details,
          context,
        };
        set(s => ({ entries: [entry, ...s.entries].slice(0, MAX_ENTRIES) }));
        console.log('[issueLog] voice event:', summary);
        scheduleAutoSend(); // voice_error / voice_silent_fail / transcribe_error are all real failures
      },
      addGpsEvent: (stage, details) => {
        // Build a context snapshot defensively via lazy requires so a
        // low-level service (gpsManager) can log without importing stores
        // at module-eval (avoids cycles). Never throws.
        let context: IssueLogEntry['context'] = {
          route: 'gps', persona: null, isRoundActive: false,
          courseId: null, currentHole: null, appVersion: '1.0.0',
        };
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const round = require('./roundStore').useRoundStore.getState();
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const settings = require('./settingsStore').useSettingsStore.getState();
          let appVersion = '1.0.0';
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            appVersion = require('expo-constants').default?.expoConfig?.version ?? '1.0.0';
          } catch { /* keep default */ }
          context = {
            route: 'gps',
            persona: settings?.caddiePersonality ?? null,
            isRoundActive: !!round?.isRoundActive,
            courseId: round?.activeCourseId ?? null,
            currentHole: round?.currentHole ?? null,
            appVersion,
          };
        } catch { /* best-effort context */ }
        const errorMessage = typeof details?.error === 'string'
          ? details.error
          : details?.error != null ? String(details.error) : null;
        const summary = errorMessage ? `gps_error: ${stage} — ${errorMessage.slice(0, 200)}` : `gps_error: ${stage}`;
        const entry: IssueLogEntry = {
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          timestamp: Date.now(),
          text: summary,
          kind: 'gps_error',
          stage,
          details,
          context,
        };
        set(s => ({ entries: [entry, ...s.entries].slice(0, MAX_ENTRIES) }));
        console.log('[issueLog] gps event:', summary);
        scheduleAutoSend();
      },
      addBootEvent: (stage, details) => {
        // TEMPORARY boot-timing breadcrumb. Mirrors addGpsEvent's defensive
        // self-context; owner-gating happens upstream in bootTrace.bootMark.
        let context: IssueLogEntry['context'] = {
          route: 'boot', persona: null, isRoundActive: false,
          courseId: null, currentHole: null, appVersion: '1.0.0',
        };
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const settings = require('./settingsStore').useSettingsStore.getState();
          context = { ...context, persona: settings?.caddiePersonality ?? null };
        } catch { /* best-effort context */ }
        const entry: IssueLogEntry = {
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          timestamp: Date.now(),
          text: `boot: ${stage}`,
          kind: 'boot',
          stage,
          details,
          context,
        };
        set(s => ({ entries: [entry, ...s.entries].slice(0, MAX_ENTRIES) }));
      },
      addAppEvent: (stage, details, kind = 'analysis_error') => {
        // Self-context snapshot via lazy requires (mirrors addGpsEvent) so
        // services/poseDetection/videoUpload can log without threading context
        // or risking a module cycle. Never throws.
        let context: IssueLogEntry['context'] = {
          route: kind === 'analysis_error' ? 'analysis' : 'app', persona: null,
          isRoundActive: false, courseId: null, currentHole: null, appVersion: '1.0.0',
        };
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const round = require('./roundStore').useRoundStore.getState();
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const settings = require('./settingsStore').useSettingsStore.getState();
          let appVersion = '1.0.0';
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            appVersion = require('expo-constants').default?.expoConfig?.version ?? '1.0.0';
          } catch { /* keep default */ }
          context = {
            route: kind === 'analysis_error' ? 'analysis' : 'app',
            persona: settings?.caddiePersonality ?? null,
            isRoundActive: !!round?.isRoundActive,
            courseId: round?.activeCourseId ?? null,
            currentHole: round?.currentHole ?? null,
            appVersion,
          };
        } catch { /* best-effort context */ }
        const errorMessage = typeof details?.error === 'string'
          ? details.error
          : details?.error != null ? String(details.error) : null;
        const summary = errorMessage ? `${kind}: ${stage} — ${errorMessage.slice(0, 200)}` : `${kind}: ${stage}`;
        const entry: IssueLogEntry = {
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          timestamp: Date.now(),
          text: summary,
          kind,
          stage,
          details,
          context,
        };
        set(s => ({ entries: [entry, ...s.entries].slice(0, MAX_ENTRIES) }));
        console.log('[issueLog] app event:', summary);
        // Real failures (analysis_error/app_error) auto-send; sim_round is an owner-only trace → skip.
        if (kind !== 'sim_round') scheduleAutoSend();
      },
      addVoiceTurn: (transcript, response, meta) => {
        const t = (transcript ?? '').trim();
        if (!t) return; // nothing said → nothing to log
        // Owner-only (mirrors bootMark / addUserIssue) — don't fill a beta tester's log
        // with their whole conversation. Fail-safe: if we can't tell, don't log.
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const prof = require('./playerProfileStore') as typeof import('./playerProfileStore');
          if (!prof.isOwnerEmail(prof.usePlayerProfileStore.getState().email)) return;
        } catch { return; }
        const reply = (response ?? '').trim();
        const summary = `voice: "${t.slice(0, 160)}" → ${reply ? `"${reply.slice(0, 160)}"` : '(no reply)'}`;
        const entry: IssueLogEntry = {
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          timestamp: Date.now(),
          text: summary,
          kind: 'voice_turn',
          details: { transcript: t, response: reply || null, ...(meta ?? {}) },
          context: selfContext('caddie'),
        };
        set(s => ({ entries: [entry, ...s.entries].slice(0, MAX_ENTRIES) }));
      },
      addUserIssue: (text) => {
        const trimmed = text.trim();
        if (!trimmed) return;
        // 2026-07-30 (issue-log audit SEV-3) — UN-GATED. This was owner-only, which silently
        // DROPPED a beta tester's spoken "log an issue" (the brain tool-path routes here, not
        // through logIssueHandler's ungated addEntry). A tester's bug report must persist AND
        // reach the team — so record it and schedule the consented auto-send, same as addEntry.
        const entry: IssueLogEntry = {
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          timestamp: Date.now(), text: trimmed, kind: 'user', context: selfContext('caddie'),
        };
        set(s => ({ entries: [entry, ...s.entries].slice(0, MAX_ENTRIES) }));
        console.log('[issueLog] user issue (voice):', trimmed.slice(0, 80));
        scheduleAutoSend();
      },
      addVoiceMiss: (missType, details) => {
        const transcript = typeof details?.transcript === 'string' ? details.transcript : '';
        const summary = `voice_miss: ${missType}${transcript ? ` — "${transcript.slice(0, 120)}"` : ''}`;
        const entry: IssueLogEntry = {
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          timestamp: Date.now(), text: summary, kind: 'voice_miss', stage: missType, details,
          context: selfContext('voice'),
        };
        set(s => ({ entries: [entry, ...s.entries].slice(0, MAX_ENTRIES) }));
        console.log('[issueLog] voice miss:', summary);
        scheduleAutoSend();
      },
      clearAll: () => set({ entries: [] }),
      remove: (id) => set(s => ({ entries: s.entries.filter(e => e.id !== id) })),
    }),
    {
      name: 'issue-log-v1',
      // 2026-06-04 — v1→v2: added kind/stage/details for voice events.
      // Legacy entries get kind='user' on read; no destructive migration.
      version: 2,
      migrate: (s) => {
        const state = s as { entries?: IssueLogEntry[] } | undefined;
        if (state?.entries) {
          state.entries = state.entries.map(e => (e.kind ? e : { ...e, kind: 'user' as const }));
        }
        return state as never;
      },
      storage: createJSONStorage(() => getPersistStorage()),
    },
  ),
);
