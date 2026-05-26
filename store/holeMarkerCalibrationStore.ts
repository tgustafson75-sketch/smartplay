/**
 * Per-hole image-marker calibration.
 *
 * Why this exists (plain English):
 *   Bundled hole images (assets/courses/COURSE/hole-XX.jpg) aren't all framed
 *   the same way. Some are straight-on shots with tee at the bottom and
 *   green at the top; doglegs and par-3s have the tee/green in totally
 *   different fractional spots. The hole-view init code historically
 *   put the tee marker at 87% of image height and pin at 10% on EVERY
 *   hole, which meant the markers landed in arbitrary positions on most
 *   images and the user had to drag them every single time.
 *
 *   This store persists the user's calibrated marker positions per
 *   (course, hole) so the FIRST drag is the LAST drag. Next round on
 *   the same course, markers come up exactly where the user put them
 *   last time. No bundled per-hole data required — calibration is
 *   self-service and incremental.
 *
 * Persistence:
 *   Stored in AsyncStorage so calibration survives app restarts AND
 *   round-end (unlike the round plan, which only persists within an
 *   active round).
 *
 * Coordinate system:
 *   `x` and `y` are fractions of the displayed image's width / height
 *   (0–1). Storing fractions instead of pixel coords means the same
 *   calibration works regardless of phone size or image scaling
 *   (Fold open vs closed, tablet, etc.).
 *
 * Lookup pattern mirrors courseGeometryOverrideStore for consistency
 * — that store handles GPS coords for tee/green; this one handles
 * image-relative marker positions. Two different concerns, two
 * different stores.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getPersistStorage } from '../services/ssrSafeStorage';

export interface HoleMarkerCalibration {
  /** Tee marker fractional position. 0.5/0.87 = the historical default. */
  tee?: { x: number; y: number };
  /** Approach / target marker — optional, defaults to mid-image if absent. */
  target?: { x: number; y: number };
  /** Pin marker — defaults to 0.5/0.10. */
  pin?: { x: number; y: number };
  /** Last update timestamp — useful for "freshness" debugging only. */
  calibrated_at?: number;
}

interface CourseCalibrations {
  [holeNumber: number]: HoleMarkerCalibration;
}

interface CalibrationState {
  byCourse: Record<string, CourseCalibrations>;
  /**
   * Save the user's calibration for a hole. Pass any subset of
   * tee/target/pin — fields not provided are left unchanged.
   */
  setCalibration: (
    courseId: string,
    hole: number,
    markers: Pick<HoleMarkerCalibration, 'tee' | 'target' | 'pin'>,
  ) => void;
  getCalibration: (courseId: string, hole: number) => HoleMarkerCalibration | null;
  clearHole: (courseId: string, hole: number) => void;
  clearCourse: (courseId: string) => void;
}

export const useHoleMarkerCalibrationStore = create<CalibrationState>()(
  persist(
    (set, get) => ({
      byCourse: {},

      setCalibration: (courseId, hole, markers) => set(s => {
        const course = s.byCourse[courseId] ?? {};
        const prev = course[hole] ?? {};
        // Merge: undefined fields don't clobber prior calibration.
        const next: HoleMarkerCalibration = {
          tee:    markers.tee    ?? prev.tee,
          target: markers.target ?? prev.target,
          pin:    markers.pin    ?? prev.pin,
          calibrated_at: Date.now(),
        };
        return {
          byCourse: {
            ...s.byCourse,
            [courseId]: { ...course, [hole]: next },
          },
        };
      }),

      getCalibration: (courseId, hole) =>
        get().byCourse[courseId]?.[hole] ?? null,

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
    }),
    {
      name: 'hole-marker-calibration-v1',
      // 2026-05-26 Fix BZ — __BZ_baseline__ version + passthrough migrate so future
      // version bumps don't wipe state. Replace `as never` with the real
      // state type when adding actual migration logic.
      version: 1,
      migrate: (s) => s as never,
      storage: createJSONStorage(() => getPersistStorage()),
    },
  ),
);
