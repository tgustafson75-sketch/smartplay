/**
 * 2026-06-13 — Green roll log (the heat-map data moat).
 *
 * Every measured putt roll (from services/putting/puttRoll.analyzePuttRoll) gets
 * logged here, keyed by course + hole. On its own each entry is one read; over
 * time they ACCUMULATE per green into the data behind a future heat map — "this
 * green breaks left from above the hole, plays fast." Cheap to log now even
 * though the heat-map render is later (v2). See memory: green-heat-mapping-goal,
 * putting-analysis-idea.
 *
 * Stores only the honest, relative read (break side/magnitude, pace, start dir,
 * approximate start point on the green) — no fabricated inches. Bounded per green
 * so the log can't grow without limit.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getPersistStorage } from '../services/ssrSafeStorage';
import type { PuttRollAnalysis } from '../services/putting/puttRoll';

const MAX_PER_GREEN = 50; // keep the most recent N rolls per green

export interface GreenRoll {
  /** Relative break side/magnitude (no inches — v1 is relative). */
  breakSide: PuttRollAnalysis['break']['side'];
  breakMagnitude: PuttRollAnalysis['break']['magnitude'];
  curvatureFraction: number;
  pace: PuttRollAnalysis['speed']['pace'];
  startSide: PuttRollAnalysis['startDirection']['side'];
  /** Normalized start point of the roll on the frame — a coarse "from where" tag. */
  fromX: number;
  fromY: number;
  made: boolean;
  ts: number;
}

interface GreenRollState {
  /** key = `${courseId}:${hole}` → recent rolls (newest last). */
  rolls: Record<string, GreenRoll[]>;
  logRoll: (
    courseId: string,
    hole: number,
    analysis: PuttRollAnalysis,
    from: { x: number; y: number },
    ts: number,
  ) => void;
  forGreen: (courseId: string, hole: number) => GreenRoll[];
  summarizeGreen: (courseId: string, hole: number) => GreenSummary | null;
  clearAll: () => void;
}

export interface GreenSummary {
  count: number;
  /** Dominant break side seen on this green, or 'mixed'. */
  dominantBreak: PuttRollAnalysis['break']['side'] | 'mixed';
  /** Dominant pace, or 'mixed'. */
  dominantPace: PuttRollAnalysis['speed']['pace'] | 'mixed';
  makeRate: number; // 0..1
}

function keyOf(courseId: string, hole: number): string {
  return `${courseId}:${hole}`;
}

function dominant<T extends string>(values: T[], mixedLabel: 'mixed'): T | 'mixed' {
  if (values.length === 0) return mixedLabel;
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: T | null = null;
  let bestN = 0;
  for (const [v, n] of counts) if (n > bestN) { best = v; bestN = n; }
  // "dominant" only if it's a real majority — otherwise honest 'mixed'.
  return best != null && bestN > values.length / 2 ? best : mixedLabel;
}

export const useGreenRollStore = create<GreenRollState>()(
  persist(
    (set, get) => ({
      rolls: {},
      logRoll: (courseId, hole, analysis, from, ts) => {
        if (!courseId || !Number.isFinite(hole)) return;
        const k = keyOf(courseId, hole);
        const entry: GreenRoll = {
          breakSide: analysis.break.side,
          breakMagnitude: analysis.break.magnitude,
          curvatureFraction: analysis.break.curvatureFraction,
          pace: analysis.speed.pace,
          startSide: analysis.startDirection.side,
          fromX: from.x,
          fromY: from.y,
          made: analysis.outcome.result === 'made',
          ts,
        };
        set((s) => {
          const prev = s.rolls[k] ?? [];
          const next = [...prev, entry].slice(-MAX_PER_GREEN);
          return { rolls: { ...s.rolls, [k]: next } };
        });
      },
      forGreen: (courseId, hole) => get().rolls[keyOf(courseId, hole)] ?? [],
      summarizeGreen: (courseId, hole) => {
        const list = get().rolls[keyOf(courseId, hole)] ?? [];
        if (list.length === 0) return null;
        // Only count rolls that actually broke when judging dominant break side.
        const broke = list.filter((r) => r.breakSide !== 'straight').map((r) => r.breakSide);
        return {
          count: list.length,
          dominantBreak: broke.length === 0 ? 'straight' : dominant(broke, 'mixed'),
          dominantPace: dominant(list.map((r) => r.pace), 'mixed'),
          makeRate: list.filter((r) => r.made).length / list.length,
        };
      },
      clearAll: () => set({ rolls: {} }),
    }),
    {
      name: 'green-rolls-v1',
      version: 1,
      storage: createJSONStorage(() => getPersistStorage()),
    },
  ),
);
