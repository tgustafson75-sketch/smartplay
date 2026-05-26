/**
 * Phase AG followup — per-user course geometry overrides.
 *
 * The upstream golfcourseapi.com returns par + yardage but NO lat/lng for
 * tees or greens, so static `data/courses.ts` falls back to all-zero
 * coordinates. Without coords, SmartFinder yardages and hole-detection
 * can't compute against the green.
 *
 * This store lets the user capture their own current GPS at each hole's
 * tee and green center as they play, building accurate per-hole geometry
 * empirically. Persisted to AsyncStorage so the data survives between
 * rounds.
 *
 * Lookup: `getEffectiveHoleGeometry(courseId, holeNumber)` → returns
 * `{teeLat, teeLng, middleLat, middleLng}` from override if captured,
 * else from static course data, else null.
 *
 * Capture: `anchorTee(courseId, hole, lat, lng)` and
 * `anchorGreen(courseId, hole, lat, lng)`. Either one updates that
 * hole's record without clobbering the other.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getPersistStorage } from '../services/ssrSafeStorage';

export interface HoleAnchor {
  teeLat?: number;
  teeLng?: number;
  middleLat?: number;
  middleLng?: number;
  anchored_at?: number;
}

interface CourseAnchors {
  [holeNumber: number]: HoleAnchor;
}

interface OverrideState {
  byCourse: Record<string, CourseAnchors>;
  anchorTee: (courseId: string, hole: number, lat: number, lng: number) => void;
  anchorGreen: (courseId: string, hole: number, lat: number, lng: number) => void;
  clearHole: (courseId: string, hole: number) => void;
  clearCourse: (courseId: string) => void;
  getHoleAnchor: (courseId: string, hole: number) => HoleAnchor | null;
  getCourseAnchorCount: (courseId: string) => number;
}

export const useCourseGeometryOverrideStore = create<OverrideState>()(
  persist(
    (set, get) => ({
      byCourse: {},

      anchorTee: (courseId, hole, lat, lng) => set(s => {
        const course = s.byCourse[courseId] ?? {};
        const prev = course[hole] ?? {};
        return {
          byCourse: {
            ...s.byCourse,
            [courseId]: {
              ...course,
              [hole]: { ...prev, teeLat: lat, teeLng: lng, anchored_at: Date.now() },
            },
          },
        };
      }),

      anchorGreen: (courseId, hole, lat, lng) => set(s => {
        const course = s.byCourse[courseId] ?? {};
        const prev = course[hole] ?? {};
        return {
          byCourse: {
            ...s.byCourse,
            [courseId]: {
              ...course,
              [hole]: { ...prev, middleLat: lat, middleLng: lng, anchored_at: Date.now() },
            },
          },
        };
      }),

      clearHole: (courseId, hole) => set(s => {
        const course = { ...(s.byCourse[courseId] ?? {}) };
        delete course[hole];
        return { byCourse: { ...s.byCourse, [courseId]: course } };
      }),

      clearCourse: (courseId) => set(s => {
        const next = { ...s.byCourse };
        delete next[courseId];
        return { byCourse: next };
      }),

      getHoleAnchor: (courseId, hole) => get().byCourse[courseId]?.[hole] ?? null,

      getCourseAnchorCount: (courseId) =>
        Object.keys(get().byCourse[courseId] ?? {}).length,
    }),
    {
      name: 'course-geometry-overrides-v1',
      // 2026-05-26 Fix BZ — __BZ_baseline__ version + passthrough migrate so future
      // version bumps don't wipe state. Replace `as never` with the real
      // state type when adding actual migration logic.
      version: 1,
      migrate: (s) => s as never,
      storage: createJSONStorage(() => getPersistStorage()),
    },
  ),
);

/**
 * Public lookup — combines override (if any) with static course data
 * passed by the caller. Caller passes the static fallback so this module
 * doesn't import from data/courses.ts (avoiding cycles).
 */
export function effectiveHoleCoords(
  courseId: string | null,
  hole: number,
  fallback: { teeLat: number; teeLng: number; middleLat: number; middleLng: number },
): { teeLat: number; teeLng: number; middleLat: number; middleLng: number } {
  if (!courseId) return fallback;
  const override = useCourseGeometryOverrideStore.getState().getHoleAnchor(courseId, hole);
  if (!override) return fallback;
  return {
    teeLat:    override.teeLat    ?? fallback.teeLat,
    teeLng:    override.teeLng    ?? fallback.teeLng,
    middleLat: override.middleLat ?? fallback.middleLat,
    middleLng: override.middleLng ?? fallback.middleLng,
  };
}
