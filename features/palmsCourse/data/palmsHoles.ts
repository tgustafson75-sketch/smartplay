/**
 * features/palmsCourse/data/palmsHoles.ts
 *
 * Lightweight re-export of the Menifee Lakes – Palms 18-hole layout.
 * Mirrors the pattern used in features/smartCaddie/data/lakesHoles.ts.
 */

import type { CourseHole } from '../../../data/courses';
import { COURSE_DB } from '../../../data/courses';

// Grab the Palms course at module load time.
const palmsCourse = COURSE_DB.find((c) => c.id === 'menifee_lakes_palms');

/**
 * All 18 holes of Menifee Lakes – Palms.
 * Falls back to an empty array if the course is not found.
 */
export const PALMS_HOLES: CourseHole[] = palmsCourse?.holes ?? [];

/**
 * Quick lookup: get a single hole by 1-based hole number.
 */
export function getPalmsHole(holeNumber: number): CourseHole | undefined {
  return PALMS_HOLES.find((h) => h.hole === holeNumber);
}

// ─── Convenience filters ──────────────────────────────────────────────────────

export const WATER_HOLES: number[] = PALMS_HOLES
  .filter((h) =>
    h.hazards?.some((hz) => hz.type === 'water') ||
    h.note.toLowerCase().includes('water') ||
    h.note.toLowerCase().includes('island'),
  )
  .map((h) => h.hole);

export const PAR_3_HOLES: number[] = PALMS_HOLES.filter((h) => h.par === 3).map((h) => h.hole);
export const PAR_4_HOLES: number[] = PALMS_HOLES.filter((h) => h.par === 4).map((h) => h.hole);
export const PAR_5_HOLES: number[] = PALMS_HOLES.filter((h) => h.par === 5).map((h) => h.hole);

// ─── Strategy metadata ────────────────────────────────────────────────────────

export type PalmsHoleType =
  | 'narrow_start'
  | 'positioning'
  | 'scoring_par3'
  | 'short_par4'
  | 'tight_fairway'
  | 'mid_par4'
  | 'tree_lined'
  | 'long_par3'
  | 'mid_par3'
  | 'par5_strategy'
  | 'reachable_par5'
  | 'dogleg'
  | 'dogleg_right'
  | 'narrow'
  | 'short_attack'
  | 'balanced'
  | 'tight_finish'
  | 'straight'
  | 'ob_left'
  | 'ob_right'
  | 'water_left'
  | 'finisher';

export interface PalmsHoleMeta {
  par:        number;
  /** GPS-verified distance to green center from back tee (yards). */
  yardage:    number;
  type:       PalmsHoleType;
  /** Depth of the green in yards — used for front/back distance offset. */
  greenDepth: number;
  /** Distance to front edge of green from back tee. GPS-verified when present. */
  frontEdge?: number;
  /** Distance to back edge of green from back tee. GPS-verified when present. */
  backEdge?:  number;
}

export const palmsHoles: Record<number, PalmsHoleMeta> = {
   1: { par: 4, yardage: 368, type: 'water_left',     greenDepth: 31, frontEdge: 352, backEdge: 383 }, // GPS-verified: creek left mid-fairway, trees right
   2: { par: 4, yardage: 353, type: 'ob_right',       greenDepth: 28, frontEdge: 339, backEdge: 367 }, // GPS-verified: OB houses right, trees left
   3: { par: 4, yardage: 352, type: 'ob_left',        greenDepth: 29, frontEdge: 338, backEdge: 367 }, // GPS-verified: straight, road OB left at tee, trees right
   4: { par: 4, yardage: 277, type: 'short_par4',     greenDepth: 28, frontEdge: 263, backEdge: 291 }, // GPS-verified: straight, trees both sides
   5: { par: 4, yardage: 367, type: 'dogleg_right',   greenDepth: 27, frontEdge: 353, backEdge: 380 }, // GPS-verified: dogleg right, bunker tee-side left
   6: { par: 4, yardage: 379, type: 'ob_left',        greenDepth: 38, frontEdge: 360, backEdge: 398 }, // GPS-verified: wide open, road OB left
   7: { par: 4, yardage: 353, type: 'tree_lined',     greenDepth: 32, frontEdge: 337, backEdge: 369 }, // GPS-verified: trees right, OB left
   8: { par: 4, yardage: 332, type: 'ob_left',        greenDepth: 34, frontEdge: 315, backEdge: 349 }, // GPS-verified: OB houses left, rough right
   9: { par: 5, yardage: 469, type: 'water_left',     greenDepth: 28, frontEdge: 455, backEdge: 483 }, // GPS-verified: water hazard left mid-fairway
  10: { par: 4, yardage: 364, type: 'dogleg',         greenDepth: 31, frontEdge: 348, backEdge: 379 }, // GPS-verified: open, trees right
  11: { par: 5, yardage: 470, type: 'ob_right',       greenDepth: 31, frontEdge: 455, backEdge: 486 }, // GPS-verified: OB houses right, trees left
  12: { par: 3, yardage: 170, type: 'mid_par3',       greenDepth: 36, frontEdge: 152, backEdge: 188 }, // GPS-verified: curved approach, trees right
  13: { par: 4, yardage: 380, type: 'straight',       greenDepth: 35, frontEdge: 362, backEdge: 397 }, // GPS-verified: trees both sides
  14: { par: 4, yardage: 455, type: 'ob_right',       greenDepth: 30, frontEdge: 440, backEdge: 470 }, // GPS-verified: OB houses right full length
  15: { par: 3, yardage: 152, type: 'scoring_par3',   greenDepth: 35, frontEdge: 134, backEdge: 169 }, // GPS-verified: trees surrounding tight par 3
  16: { par: 4, yardage: 375, type: 'ob_left',        greenDepth: 27, frontEdge: 362, backEdge: 389 }, // GPS-verified: road OB left, trees right
  17: { par: 4, yardage: 330, type: 'tight_finish',   greenDepth: 31, frontEdge: 315, backEdge: 346 }, // GPS-verified: trees both sides
  18: { par: 4, yardage: 365, type: 'finisher',       greenDepth: 31, frontEdge: 350, backEdge: 381 }, // GPS-verified: trees both sides
};

export function getPalmsHoleMeta(holeNumber: number): PalmsHoleMeta | undefined {
  return palmsHoles[holeNumber];
}
