/**
 * features/smartCaddie/data/lakesHoles.ts
 *
 * Lightweight re-export of the Menifee Lakes – Lakes 18-hole layout.
 * Used by SmartCaddieEngine for hole-specific strategy logic without
 * importing the full COURSE_DB bundle.
 */

import type { CourseHole } from '../../../data/courses';
import { COURSE_DB } from '../../../data/courses';

// Grab the Lakes course once at module load time (deterministic index).
const lakesCourse = COURSE_DB.find((c) => c.id === 'menifee_lakes_lakes');

/**
 * All 18 holes of Menifee Lakes – Lakes.
 * Falls back to an empty array if the course is not found.
 */
export const LAKES_HOLES: CourseHole[] = lakesCourse?.holes ?? [];

/**
 * Quick lookup: get a single hole by 1-based hole number.
 * Returns undefined if the hole doesn't exist.
 */
export function getLakesHole(holeNumber: number): CourseHole | undefined {
  return LAKES_HOLES.find((h) => h.hole === holeNumber);
}

/**
 * Holes that have water hazards — useful for aggressive-vs-safe decisions.
 */
export const WATER_HOLES: number[] = LAKES_HOLES
  .filter((h) => h.hazards?.some((hz) => hz.type === 'water') || h.note.toLowerCase().includes('water') || h.note.toLowerCase().includes('lake'))
  .map((h) => h.hole);

/**
 * Holes classified by par for quick filtering.
 */
export const PAR_3_HOLES: number[] = LAKES_HOLES.filter((h) => h.par === 3).map((h) => h.hole);
export const PAR_4_HOLES: number[] = LAKES_HOLES.filter((h) => h.par === 4).map((h) => h.hole);
export const PAR_5_HOLES: number[] = LAKES_HOLES.filter((h) => h.par === 5).map((h) => h.hole);

// ─────────────────────────────────────────────────────────────────────────────
// Hole intelligence map — strategy metadata for SmartCaddieEngine
// ─────────────────────────────────────────────────────────────────────────────

export type HoleType =
  | 'risk_water_right'
  | 'risk_water_left'
  | 'water_right_narrow'
  | 'positioning'
  | 'scoring_par3'
  | 'scoring_par5'
  | 'long_par3'
  | 'long_par4'
  | 'reachable_par5'
  | 'balanced'
  | 'risk_reward'
  | 'straightforward';

export type HoleStrategy =
  | 'safe_left'
  | 'safe_right'
  | 'distance_control'
  | 'distance_then_center'
  | 'accuracy_priority'
  | 'fairway_first'
  | 'center_green'
  | 'full_commit'
  | 'commit_decision'
  | 'lay_up'
  | '3shot_or_aggressive'
  | 'standard';

export interface LakesHoleMeta {
  par: number;
  yardage: number;
  type: HoleType;
  strategy: HoleStrategy;
  /** True = birdie opportunity; false = bogey avoidance priority */
  scoring: boolean;
}

export const lakesHoles: Record<number, LakesHoleMeta> = {
  1: {
    par:      4,
    yardage:  368,
    type:     'risk_water_right',
    strategy: 'safe_left',
    scoring:  false,
  },
  2: {
    par:      4,
    yardage:  353,
    type:     'positioning',
    strategy: 'distance_control',
    scoring:  false,
  },
  3: {
    par:      3,
    yardage:  134,
    type:     'scoring_par3',
    strategy: 'full_commit',
    scoring:  true,
  },
  4: {
    par:      4,
    yardage:  277,
    type:     'risk_reward',
    strategy: 'commit_decision',
    scoring:  true,
  },
  5: {
    par:      4,
    yardage:  367,
    type:     'water_right_narrow',
    strategy: 'accuracy_priority',
    scoring:  false,
  },
  6: {
    par:      4,
    yardage:  383,
    type:     'long_par4',
    strategy: 'distance_then_center',
    scoring:  false,
  },
  7: {
    par:      4,
    yardage:  355,
    type:     'balanced',
    strategy: 'fairway_first',
    scoring:  false,
  },
  8: {
    par:      3,
    yardage:  193,
    type:     'long_par3',
    strategy: 'center_green',
    scoring:  false,
  },
  9: {
    par:      5,
    yardage:  491,
    type:     'reachable_par5',
    strategy: '3shot_or_aggressive',
    scoring:  true,
  },
  10: {
    par:      4,
    yardage:  370,
    type:     'risk_water_right',
    strategy: 'safe_left',
    scoring:  false,
  },
  11: {
    par:      3,
    yardage:  155,
    type:     'scoring_par3',
    strategy: 'full_commit',
    scoring:  true,
  },
  12: {
    par:      5,
    yardage:  525,
    type:     'scoring_par5',
    strategy: 'commit_decision',
    scoring:  true,
  },
  13: {
    par:      4,
    yardage:  420,
    type:     'risk_water_left',
    strategy: 'safe_right',
    scoring:  false,
  },
  14: {
    par:      4,
    yardage:  390,
    type:     'positioning',
    strategy: 'distance_control',
    scoring:  false,
  },
  15: {
    par:      3,
    yardage:  165,
    type:     'scoring_par3',
    strategy: 'full_commit',
    scoring:  true,
  },
  16: {
    par:      4,
    yardage:  405,
    type:     'risk_water_right',
    strategy: 'safe_left',
    scoring:  false,
  },
  17: {
    par:      5,
    yardage:  540,
    type:     'scoring_par5',
    strategy: 'commit_decision',
    scoring:  true,
  },
  18: {
    par:      4,
    yardage:  430,
    type:     'risk_water_right',
    strategy: 'safe_left',
    scoring:  false,
  },
};

/**
 * Convenience lookup — get strategy metadata for a 1-based hole number.
 * Returns null for holes without explicit data.
 */
export function getLakesHoleMeta(holeNumber: number): LakesHoleMeta | null {
  return lakesHoles[holeNumber] ?? null;
}

/** All scoring holes (birdie-opportunity priority). */
export const SCORING_HOLES: number[] = Object.entries(lakesHoles)
  .filter(([, m]) => m.scoring)
  .map(([n]) => Number(n));
