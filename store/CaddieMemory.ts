/**
 * CaddieMemory.ts
 *
 * Stores player tendencies derived from practice sessions.
 * Persisted via AsyncStorage so tendencies survive app restarts.
 *
 * updateMemoryFromSession(sessionData) — call after a Swing Lab session ends.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Types ────────────────────────────────────────────────────────────────────

export type SwingPath      = 'in-to-out' | 'out-to-in' | 'neutral';
export type FaceAngle      = 'open' | 'closed' | 'square';
export type BallStartBias  = 'left' | 'right' | 'neutral';
export type ShotShapeTrend = 'slice' | 'fade' | 'straight' | 'draw' | 'hook' | 'push' | 'pull' | 'neutral';

export interface CaddieMemoryData {
  missBias:        'left' | 'right' | 'neutral';
  contactTrend:    'fat' | 'thin' | 'clean';
  swingPath:       SwingPath;
  faceAngle:       FaceAngle;
  ballStartBias:   BallStartBias;   // dominant start-line direction
  shotShapeTrend:  ShotShapeTrend;  // dominant ball-flight shape
  longTermBias:    'left' | 'right' | 'neutral'; // multi-session trend bias
  confidence:      number;
  confidenceScore: number;
  lastUpdated:     number;
}

/** Minimal shape of a completed Swing Lab session passed to updateMemoryFromSession. */
export interface SessionData {
  totalShots:    number;
  leftCount:     number;
  rightCount:    number;
  straightCount: number;
  fatCount:      number;
  thinCount:     number;
  cleanCount:    number;
  /** Optional — provided when video frame analysis is available (swing-lab / practice). */
  swingPath?:    SwingPath;
  faceAngle?:    FaceAngle;
  /**
   * Optional ball-tracking data from BallTrackingEngine / practice sessions.
   * Each entry is a recorded shot's start direction and finished direction.
   */
  shotShapeData?: Array<{ ballStart: BallStartBias; finish: 'left' | 'straight' | 'right' }>;
}

interface CaddieMemoryState extends CaddieMemoryData {
  updateMemoryFromSession: (sessionData: SessionData) => void;
  updateLongTermBias: (bias: 'left' | 'right' | 'neutral', newConfidenceScore?: number) => void;
  reset: () => void;
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_MEMORY: CaddieMemoryData = {
  missBias:        'neutral',
  contactTrend:    'clean',
  swingPath:       'neutral',
  faceAngle:       'square',
  ballStartBias:   'neutral',
  shotShapeTrend:  'neutral',
  longTermBias:    'neutral',
  confidence:      0,
  confidenceScore: 0,
  lastUpdated:     0,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Clamp a value between min and max (inclusive). */
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

/**
 * Compute the dominant contact type from counts.
 * Returns the highest of fat/thin/clean; ties default to 'clean'.
 */
const dominantContact = (
  fat: number,
  thin: number,
  clean: number,
): CaddieMemoryData['contactTrend'] => {
  if (fat >= thin && fat >= clean) return 'fat';
  if (thin >= clean)               return 'thin';
  return 'clean';
};

/**
 * Confidence scoring:
 * - High shot counts boost confidence (max gain per session = 40 pts)
 * - Contradictions (new bias opposes stored bias) reduce confidence by 20 pts
 * - Agreement reinforces confidence by 10 pts
 * - Final value is always clamped to [0, 100]
 */
const computeConfidence = (
  prev: CaddieMemoryData,
  newBias: CaddieMemoryData['missBias'],
  totalShots: number,
): number => {
  // Volume bonus: each shot beyond 3 contributes incremental confidence
  const volumeBonus = clamp(Math.round((totalShots / 20) * 40), 0, 40);

  let delta = 0;
  if (prev.confidence === 0) {
    // First ever update — seed directly from volume
    delta = volumeBonus;
  } else if (newBias !== 'neutral' && prev.missBias !== 'neutral' && newBias !== prev.missBias) {
    // Contradiction: new session contradicts stored tendency
    delta = -20 + volumeBonus;
  } else {
    // Agreement or neutral update
    delta = 10 + volumeBonus;
  }

  return clamp(prev.confidence + delta, 0, 100);
};

/**
 * Composite confidence score (0–100).
 * Rewards:
 *   - High shot volume
 *   - Swing-data present (swingPath / faceAngle provided)
 *   - Alignment between missBias and faceAngle/swingPath
 * Penalises contradictions between sessions.
 */
const computeCompositeConfidence = (
  prev:        CaddieMemoryData,
  newBias:     CaddieMemoryData['missBias'],
  newPath:     SwingPath,
  newFace:     FaceAngle,
  totalShots:  number,
  hasSwingData: boolean,
): number => {
  const volumeBonus     = clamp(Math.round((totalShots / 20) * 30), 0, 30);
  const swingDataBonus  = hasSwingData ? 20 : 0;

  // Alignment bonus: miss direction matches face/path explanation
  let alignmentBonus = 0;
  if ((newBias === 'right' && newFace === 'open')   ||
      (newBias === 'left'  && newFace === 'closed')  ||
      (newBias === 'right' && newPath === 'out-to-in') ||
      (newBias === 'left'  && newPath === 'in-to-out')) {
    alignmentBonus = 20;
  } else if (newBias === 'neutral' && newFace === 'square' && newPath === 'neutral') {
    alignmentBonus = 10; // everything consistent and clean
  }

  // Contradiction penalty: stored pattern contradicts new session
  let contradiction = 0;
  if (prev.confidenceScore > 0) {
    if (newBias !== 'neutral' && prev.missBias !== 'neutral' && newBias !== prev.missBias) {
      contradiction = -20;
    }
    if (hasSwingData && newPath !== 'neutral' && prev.swingPath !== 'neutral' && newPath !== prev.swingPath) {
      contradiction -= 10;
    }
  }

  const raw = prev.confidenceScore === 0
    ? volumeBonus + swingDataBonus + alignmentBonus
    : prev.confidenceScore + 5 + volumeBonus * 0.3 + swingDataBonus * 0.3 + alignmentBonus * 0.3 + contradiction;

  return clamp(Math.round(raw), 0, 100);
};

// ─── Store ────────────────────────────────────────────────────────────────────

export const useCaddieMemory = create<CaddieMemoryState>()(
  persist(
    (set, get) => ({
      ...DEFAULT_MEMORY,

      updateMemoryFromSession: (sessionData: SessionData) => {
        const {
          totalShots, leftCount, rightCount,
          fatCount, thinCount, cleanCount,
          swingPath: incomingPath,
          faceAngle: incomingFace,
          shotShapeData,
        } = sessionData;

        if (totalShots === 0) return;

        const leftPct  = leftCount  / totalShots;
        const rightPct = rightCount / totalShots;

        // Miss bias: >60% threshold required to declare a directional bias
        let newBias: CaddieMemoryData['missBias'] = 'neutral';
        if (rightPct > 0.60) newBias = 'right';
        else if (leftPct > 0.60) newBias = 'left';

        // Infer swingPath / faceAngle from shot data when not supplied directly.
        const newPath: SwingPath = incomingPath ?? (
          rightPct > 0.60 ? 'out-to-in' :
          leftPct  > 0.60 ? 'in-to-out' :
          'neutral'
        );
        const newFace: FaceAngle = incomingFace ?? (
          rightPct > 0.60 ? 'open' :
          leftPct  > 0.60 ? 'closed' :
          'square'
        );

        // ── Ball start bias ──────────────────────────────────────────────
        // Derived from shotShapeData when available; falls back to missBias.
        let newBallStartBias: BallStartBias = 'neutral';
        if (shotShapeData && shotShapeData.length > 0) {
          const startLeft  = shotShapeData.filter((s) => s.ballStart === 'left').length;
          const startRight = shotShapeData.filter((s) => s.ballStart === 'right').length;
          const startTotal = shotShapeData.length;
          if (startRight / startTotal > 0.55) newBallStartBias = 'right';
          else if (startLeft / startTotal > 0.55) newBallStartBias = 'left';
        } else {
          // Fallback: start bias mirrors miss bias (no dispersion data)
          newBallStartBias = newBias as BallStartBias;
        }

        // ── Shot shape trend ─────────────────────────────────────────────
        // Classify each shot and pick the plurality shape.
        let newShapeTrend: ShotShapeTrend = 'neutral';
        if (shotShapeData && shotShapeData.length > 0) {
          const shapeCounts: Record<ShotShapeTrend, number> = {
            slice: 0, fade: 0, straight: 0, draw: 0,
            hook: 0, push: 0, pull: 0, neutral: 0,
          };
          for (const s of shotShapeData) {
            const start  = s.ballStart;
            const finish = s.finish;
            let shape: ShotShapeTrend = 'neutral';
            if (start === 'right' && finish === 'right')    shape = 'push';
            else if (start === 'right' && finish === 'left')  shape = 'slice';
            else if (start === 'right' && finish === 'straight') shape = 'fade';
            else if (start === 'left'  && finish === 'right')  shape = 'draw';
            else if (start === 'left'  && finish === 'left')   shape = 'pull';
            else if (start === 'left'  && finish === 'straight') shape = 'hook';
            else if (start === 'neutral' && finish === 'right') shape = 'fade';
            else if (start === 'neutral' && finish === 'left')  shape = 'draw';
            else shape = 'straight';
            shapeCounts[shape]++;
          }
          // Pick plurality (exclude neutral from dominance check)
          const sorted = (Object.entries(shapeCounts) as [ShotShapeTrend, number][])
            .filter(([k]) => k !== 'neutral')
            .sort((a, b) => b[1] - a[1]);
          if (sorted.length > 0 && sorted[0][1] > 0) {
            newShapeTrend = sorted[0][0];
          }
        } else {
          // Infer from face/path when no tracking data
          if (newFace === 'open'   && newPath === 'out-to-in') newShapeTrend = 'slice';
          else if (newFace === 'open')   newShapeTrend = 'fade';
          else if (newFace === 'closed' && newPath === 'in-to-out') newShapeTrend = 'hook';
          else if (newFace === 'closed') newShapeTrend = 'draw';
          else if (newFace === 'square') newShapeTrend = 'straight';
        }

        const hasSwingData = !!(incomingPath && incomingFace);
        const newContactTrend = dominantContact(fatCount, thinCount, cleanCount);
        const prev = get();
        const newConfidence = computeConfidence(prev, newBias, totalShots);
        const newComposite  = computeCompositeConfidence(
          prev, newBias, newPath, newFace, totalShots, hasSwingData,
        );

        set({
          missBias:        newBias,
          contactTrend:    newContactTrend,
          swingPath:       newPath,
          faceAngle:       newFace,
          ballStartBias:   newBallStartBias,
          shotShapeTrend:  newShapeTrend,
          // longTermBias preserved — updated separately via updateLongTermBias
          confidence:      newConfidence,
          confidenceScore: newComposite,
          lastUpdated:     Date.now(),
        });
      },

      /**
       * Called by TrendEngine after analysing multiple sessions.
       * Updates the long-term bias and optionally the composite confidence score.
       */
      updateLongTermBias: (bias, newConfidenceScore) => {
        set((state) => ({
          longTermBias:    bias,
          confidenceScore: newConfidenceScore !== undefined
            ? clamp(newConfidenceScore, 0, 100)
            : state.confidenceScore,
          lastUpdated: Date.now(),
        }));
      },

      reset: () => set({ ...DEFAULT_MEMORY }),
    }),
    {
      name:    'caddie-memory',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
