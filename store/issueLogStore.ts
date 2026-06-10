/**
 * Owner-only issue log.
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
 * captures the rest of the utterance as the note). Settings exposes
 * an "Owner Logs" surface for Tim to review + copy + clear.
 *
 * Gated to the owner email via isOwnerEmail() in the voice intent
 * registration step — non-owner installs don't see the surface and
 * the intent silently no-ops.
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
  | 'app_error';

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
  /** Analysis / frame-extraction / any-other-failure auto-log. Self-context
   *  like addGpsEvent so low-level services can call it freely. `kind` defaults
   *  to 'analysis_error'; pass 'app_error' for non-analysis failures. */
  addAppEvent: (
    stage: string,
    details?: Record<string, unknown>,
    kind?: 'analysis_error' | 'app_error',
  ) => void;
  clearAll: () => void;
  remove: (id: string) => void;
}

const MAX_ENTRIES = 100;

export const useIssueLogStore = create<IssueLogState>()(
  persist(
    (set) => ({
      entries: [],
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
