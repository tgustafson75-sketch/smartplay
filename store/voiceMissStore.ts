/**
 * Voice-miss log — captures every voice command that didn't get
 * matched to a wired handler, so the owner has a record of what
 * users actually tried that wasn't covered. Pairs with the issue
 * log (store/issueLogStore.ts) which captures spoken bug reports
 * via the log_issue intent; this store captures the COMMANDS that
 * FAILED to dispatch, which is a different question.
 *
 * Three miss types are logged (mirroring services/voiceCommandRouter
 * dispatch()):
 *   - 'classifier_unknown': intent_type came back 'unknown' OR
 *     confidence was 'low'. The phrasing didn't classify.
 *   - 'no_handler': classifier returned a known intent_type but no
 *     registered handler exists in the router. (Forward-compat or
 *     orphan classifier output.)
 *   - 'handler_error': handler matched and ran but threw during
 *     execute(). Includes the truncated error message.
 *
 * The spoken fallback to the user is UNCHANGED — this log is purely
 * additive instrumentation behind the existing honest-failure UX.
 *
 * Persisted to AsyncStorage under 'voice-misses-v1'. Capped at 100
 * entries FIFO. Surface is owner-only (app/voice-misses.tsx, gated by
 * isOwnerEmail() like owner-logs.tsx).
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getPersistStorage } from '../services/ssrSafeStorage';

export type VoiceMissType = 'classifier_unknown' | 'no_handler' | 'handler_error';

export interface VoiceMissEntry {
  /** Stable id: `${timestamp}_${random}`. */
  id: string;
  /** ms-since-epoch when the miss was recorded. */
  timestamp: number;
  /** What the user said (verbatim transcript). */
  transcript: string;
  /** Which class of miss this is — guides what to do about it. */
  missType: VoiceMissType;
  /** Classifier's intent_type when available. Present for 'no_handler'
   *  and 'handler_error'; null for 'classifier_unknown'. */
  intent_type: string | null;
  /** Truncated error message — populated only for 'handler_error'. */
  error_message: string | null;
  /** App surface the user was on when they spoke (from
   *  services/activeSurfaceRegistry.getActiveSurface()). null when
   *  no surface is registered. */
  surface: string | null;
  /** Lightweight context snapshot, parallel to IssueLogEntry.context. */
  context: {
    persona: string | null;
    isRoundActive: boolean;
    currentHole: number | null;
  };
}

interface VoiceMissState {
  entries: VoiceMissEntry[];
  addMiss: (entry: Omit<VoiceMissEntry, 'id' | 'timestamp'>) => void;
  clearAll: () => void;
  remove: (id: string) => void;
}

const MAX_ENTRIES = 100;

export const useVoiceMissStore = create<VoiceMissState>()(
  persist(
    (set) => ({
      entries: [],
      addMiss: (partial) => {
        const transcript = (partial.transcript ?? '').trim();
        if (!transcript) return;
        const entry: VoiceMissEntry = {
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          timestamp: Date.now(),
          transcript,
          missType: partial.missType,
          intent_type: partial.intent_type,
          error_message: partial.error_message,
          surface: partial.surface,
          context: partial.context,
        };
        set(s => ({ entries: [entry, ...s.entries].slice(0, MAX_ENTRIES) }));
        console.log('[voiceMiss]', partial.missType, '·', transcript.slice(0, 80));
      },
      clearAll: () => set({ entries: [] }),
      remove: (id) => set(s => ({ entries: s.entries.filter(e => e.id !== id) })),
    }),
    {
      name: 'voice-misses-v1',
      // 2026-05-26 Fix BZ — __BZ_baseline__ version + passthrough migrate so future
      // version bumps don't wipe state. Replace `as never` with the real
      // state type when adding actual migration logic.
      version: 1,
      migrate: (s) => s as never,
      storage: createJSONStorage(() => getPersistStorage()),
    },
  ),
);
