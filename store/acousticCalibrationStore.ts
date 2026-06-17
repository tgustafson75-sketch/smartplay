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

// 2026-05-28 — Fix FC (Path C, Pass A): the LIVE acoustic detector
// (services/acousticImpactDetector.ts) reads from `appliedCalibration`
// when present, falling back to constants/cageDetection.ts when not.
// One source of truth, per-device — captures the user's actual mic /
// floor / range conditions instead of universal defaults that assume
// a phone-mic ~6-10ft from the player.
export interface AppliedCalibration {
  /** Median noise floor (dBFS) observed in the calibration session. */
  noiseFloorDb: number;
  /** Recommended TRANSIENT_THRESHOLD_DB offset above noise floor for
   *  this user/device combo. Detector uses this in place of the
   *  hardcoded 18dB constant when applied calibration is present. */
  transientThresholdDb: number;
  /** Session id this calibration was derived from — useful for the
   *  test-bench history to mark "this is your active calibration." */
  sourceSessionId: string;
  /** When the user applied this calibration. */
  appliedAt: number;
}

interface AcousticCalibrationState {
  sessions: CalibrationSession[];
  /** 2026-05-28 — Fix FC: active per-device tuning. Null = use the
   *  hardcoded defaults in constants/cageDetection.ts. */
  appliedCalibration: AppliedCalibration | null;
  /** 2026-05-28 — Fix FH: one-time dismissal flag for the first-cage
   *  calibration prompt. When true, the SETUP-phase banner that
   *  suggests running the test bench is suppressed forever (per
   *  device). Cleared by reset(). */
  calibratePromptDismissed: boolean;
  /** Labeled hit samples from the target calibration screen. Rolling
   *  buffer — capped at MAX_TARGET_SAMPLES. Persisted so the dataset
   *  survives app restarts and accumulates across sessions. */
  targetSamples: CageTargetSample[];
  /** Append a new labeled target sample. Auto-trims to last 200. */
  addTargetSample: (sample: Omit<CageTargetSample, 'id' | 'capturedAt'>) => string;
  /** Remove all target samples. Owner-only utility. */
  clearTargetSamples: () => void;
  /** Append a new calibration session. Auto-trims to last 50 to keep
   *  AsyncStorage payload bounded — beyond ~50 sessions the tail is
   *  no longer informative for tuning. */
  saveSession: (session: Omit<CalibrationSession, 'id' | 'capturedAt'>) => string;
  /** 2026-05-28 — Fix FC: take a saved session and promote it to
   *  appliedCalibration. Caller passes the session id; we derive the
   *  noise floor + a sensible transientThresholdDb from the corrected
   *  strikes' peaks relative to floor. Pass null to clear (revert to
   *  hardcoded defaults). */
  applyCalibrationFromSession: (sessionId: string) => boolean;
  clearAppliedCalibration: () => void;
  /** 2026-05-28 — Fix FH: persist the one-shot dismissal so the
   *  calibration prompt doesn't re-pester a user who already chose
   *  to skip. Calling apply on any session also clears this flag
   *  (calibration completes the loop — user can re-prompt later
   *  by clearing applied calibration in owner tools). */
  dismissCalibratePrompt: () => void;
  /** Remove a session by id. Used by the in-app delete affordance. */
  deleteSession: (id: string) => void;
  /** Clear everything. Owner-only utility for debugging. */
  clearAll: () => void;
}

const MAX_SESSIONS = 50;
const MAX_TARGET_SAMPLES = 200;

function newSessionId(): string {
  return 'acal_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
}

// ─── Target calibration — labeled acoustic dataset ───────────────────────────
// Each sample pairs a WAV recording with the manually confirmed hit position
// on the cage canvas. Over time the corpus lets us find spectral features that
// discriminate canvas center vs edge vs net — and eventually auto-classify
// live shots.

export type TargetHitType = 'canvas_center' | 'canvas_edge' | 'net';

export interface CageTargetSample {
  id: string;
  capturedAt: number;
  /** WAV file URI from the impact recorder. Null if recording failed. */
  wavUri: string | null;
  /** Peak dBFS at impact from the metering path. */
  peakDb: number;
  /** Milliseconds from recording start to peak. */
  impactMs: number;
  /** User-confirmed hit category. */
  hitType: TargetHitType;
  /** Relative position within the canvas (only meaningful when hitType !== 'net').
   *  -1 = left/bottom edge, 0 = center, +1 = right/top edge. */
  hitX: number | null;
  hitY: number | null;
  /** Cage geometry at time of capture — for physics calculations later. */
  cage: {
    widthFt: number;
    heightFt: number;
    canvasSizeFt: number;
  };
}

export const useAcousticCalibrationStore = create<AcousticCalibrationState>()(
  persist(
    (set, get) => ({
      sessions: [],
      appliedCalibration: null,
      calibratePromptDismissed: false,
      targetSamples: [],
      addTargetSample: (input) => {
        const id = 'tgt_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
        const sample: CageTargetSample = { ...input, id, capturedAt: Date.now() };
        set((s) => ({ targetSamples: [...s.targetSamples, sample].slice(-MAX_TARGET_SAMPLES) }));
        console.log(`[cageTarget] sample id=${id} type=${sample.hitType} x=${sample.hitX?.toFixed(2)} y=${sample.hitY?.toFixed(2)} peak=${sample.peakDb.toFixed(1)}dB`);
        return id;
      },
      clearTargetSamples: () => set({ targetSamples: [] }),
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
      // 2026-05-28 — Fix FC: derive AppliedCalibration from a saved
      // session. Uses the session's measured floor + the median peak
      // of the user-corrected strikes to pick a threshold that
      // (a) sits ~60% of the way between floor and the user's typical
      // strike peak — generous enough to catch their actual strikes,
      // tight enough to reject noise. (b) never drops below 8 dB above
      // floor so a quiet user can't mis-tune into "everything is a
      // strike." Returns false if the session has no corrected
      // strikes (nothing to learn from).
      applyCalibrationFromSession: (sessionId) => {
        const sess = get().sessions.find(s => s.id === sessionId);
        if (!sess) return false;
        const strikes = sess.corrected.length > 0 ? sess.corrected : sess.autoDetected;
        if (strikes.length === 0) return false;
        const peaks = strikes
          .map(s => s.peakDb)
          .filter((v): v is number => typeof v === 'number');
        if (peaks.length === 0) return false;
        // median peak — robust to a single outlier strike.
        const sorted = [...peaks].sort((a, b) => a - b);
        const medianPeak = sorted[Math.floor(sorted.length / 2)];
        const floor = sess.floorDb;
        // 60% of the way from floor to medianPeak, but at minimum 8dB
        // over floor. Hardcoded constant default is 18dB; user-tuned
        // values typically land 10-22dB depending on mic distance.
        const span = medianPeak - floor;
        const recommended = Math.max(8, Math.round(span * 0.6));
        set({
          appliedCalibration: {
            noiseFloorDb: floor,
            transientThresholdDb: recommended,
            sourceSessionId: sessionId,
            appliedAt: Date.now(),
          },
        });
        console.log(`[acousticCalibration] applied calibration from session=${sessionId} floor=${floor.toFixed(1)} thresh=${recommended}dB (medianPeak=${medianPeak.toFixed(1)})`);
        return true;
      },
      clearAppliedCalibration: () => {
        set({ appliedCalibration: null });
        console.log('[acousticCalibration] cleared applied calibration (reverting to constants/cageDetection.ts defaults)');
      },
      dismissCalibratePrompt: () => {
        set({ calibratePromptDismissed: true });
      },
      deleteSession: (id) =>
        set((s) => ({ sessions: s.sessions.filter((x) => x.id !== id) })),
      clearAll: () => set({ sessions: [], appliedCalibration: null, calibratePromptDismissed: false }),
    }),
    {
      name: 'acoustic-calibration-v1',
      version: 2,
      migrate: (persisted, version) => {
        const s = persisted as AcousticCalibrationState;
        // v1 → v2: added targetSamples array
        if (version < 2) { (s as unknown as Record<string, unknown>).targetSamples = []; }
        return s;
      },
      storage: createJSONStorage(() => getPersistStorage()),
    },
  ),
);
