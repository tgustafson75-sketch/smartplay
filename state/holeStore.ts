/**
 * state/holeStore.ts
 *
 * Lightweight singleton store for the active hole context.
 * Designed for the Precision Vision pipeline — non-React (no Zustand) so it
 * can be imported from pure-engine files without bridge overhead.
 *
 * Usage:
 *   import { setCurrentHole, getCurrentHole } from '../state/holeStore';
 *   setCurrentHole(COURSE_DB[courseIdx].holes[holeIdx]);
 *   const hole = getCurrentHole();   // CourseHole | null
 */

import type { CourseHole } from '../data/courses';

let currentHole: CourseHole | null = null;

export const setCurrentHole = (hole: CourseHole | null): void => {
  currentHole = hole;
};

export const getCurrentHole = (): CourseHole | null => currentHole;

/**
 * Convenience accessor — throws if no hole is set.
 * Use this inside the Precision Engine to enforce the "always inject holeData" contract.
 */
export const requireCurrentHole = (): CourseHole => {
  if (!currentHole) {
    throw new Error('[holeStore] No active hole set. Call setCurrentHole() before running the precision engine.');
  }
  return currentHole;
};
