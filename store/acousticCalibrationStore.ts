/**
 * 2026-05-26 — Fix BO: acoustic calibration session store.
 *
 * Tim's intent for the test bench Phase 2: capture a multi-swing
 * session, auto-detect the strikes, let the user slide to correct
 * any misses (or add manually marked ones), then SAVE the result as
 * ground-truth calibration data. Over time the corrected sessions
 * become a labeled dataset we can use to tune the strikeDetector
 * algorithm (and eventually the Python cage-analysis backend's
 * audio.detect_strikes pass).
 *
 * Lives client-side via Zustand + persist for now. Future: ship
 * sessions to a backend collector when calibration becomes a
 * cross-device training corpus.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getPersistStorage } from '../services/ssrSafeStorage';
import type { DetectedStrike } from '../services/swing/strikeDetector';

export interface CalibrationSession {
  /** Locally-generated session id (epoch + random suffix). */
  id: string;
  capturedAt: number;
  durationMs: number;
  floorDb: number;
  /** What the algorithm found before any user correction. */
  autoDetected: DetectedStrike[];
  /** What the user corrected to (drag-adjusted timestamps, manual
   *  additions, deletions). Same shape as autoDetected. When the
   *  user didn't change anything, this is a copy of autoDetected. */
  corrected: DetectedStrike[];
  sampleCount: number;
  notes?: string | null;
}

interface AcousticCalibrationState {
  sessions: CalibrationSession[];
  /** Append a new calibration session. Auto-trims to last 50 to keep
   *  AsyncStorage payload bounded — beyond ~50 sessions the tail is
   *  no longer informative for tuning. */
  saveSession: (session: Omit<CalibrationSession, 'id' | 'capturedAt'>) => string;
  /** Remove a session by id. Used by the in-app delete affordance. */
  deleteSession: (id: string) => void;
  /** Clear everything. Owner-only utility for debugging. */
  clearAll: () => void;
}

const MAX_SESSIONS = 50;

function newSessionId(): string {
  return 'acal_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
}

export const useAcousticCalibrationStore = create<AcousticCalibrationState>()(
  persist(
    (set) => ({
      sessions: [],
      saveSession: (input) => {
        const id = newSessionId();
        const session: CalibrationSession = {
          ...input,
          id,
          capturedAt: Date.now(),
        };
        set((s) => ({
          sessions: [...s.sessions, session].slice(-MAX_SESSIONS),
        }));
        console.log(
          `[acousticCalibration] saved id=${id} auto=${session.autoDetected.length} ` +
          `corrected=${session.corrected.length} duration=${session.durationMs}ms`,
        );
        return id;
      },
      deleteSession: (id) =>
        set((s) => ({ sessions: s.sessions.filter((x) => x.id !== id) })),
      clearAll: () => set({ sessions: [] }),
    }),
    {
      name: 'acoustic-calibration-v1',
      version: 1,
      storage: createJSONStorage(() => getPersistStorage()),
    },
  ),
);
