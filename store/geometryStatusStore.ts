/**
 * Observable status for course-geometry builds.
 *
 * 2026-08-13 (Tim's Wachusett round — "yardage showed static the whole time and I got no status
 * updates; you shouldn't be able to be in a live round and have it show static") — the ROOT cause,
 * and it was not in the geometry code, which did its job correctly.
 *
 * courseGeometryService tracked in-flight builds in a module-level `inflight` Map and, on completion,
 * called `inflight.delete(courseId)` — telling nobody. The caddie screen read `isGeometryBuilding()`
 * as a plain function call DURING RENDER. A module-level Map cannot trigger a React render, so:
 *
 *   • the "BUILDING" badge only appeared if something unrelated happened to re-render the screen
 *   • when the build FINISHED, nothing re-rendered — so the yardage stayed on the static-card tier
 *     even though the green coordinates it needed had just arrived
 *   • refreshing GPS didn't help: the live tier needs a green coord, and the component never re-asked
 *
 * A whole round on a frozen STATIC badge while the app had already finished the work.
 *
 * This is the same shape as two other defects found the same day (the earbud voice state, the avatar
 * freeze): a module-level service holding state the UI depends on, with no way for the UI to
 * subscribe. Individually correct halves, no wire between them — which is exactly why file-by-file
 * audits never found any of them.
 *
 * The fix is to make the state OBSERVABLE, not to restructure the geometry engine. The service keeps
 * its `inflight` Map as the source of truth for deduping concurrent builds; it now also publishes
 * transitions here, and the UI subscribes. One store, written in exactly two places (start, finish).
 */
import { create } from 'zustand';

interface GeometryStatusState {
  /** courseId → true while a build is in flight. Absent/false = not building. */
  building: Record<string, boolean>;
  /**
   * Bumped on every COMPLETION. Components can depend on this to re-derive anything computed from
   * geometry — yardage above all — the moment new greens land, without knowing which course it was.
   */
  completions: number;
  markBuilding: (courseId: string) => void;
  markDone: (courseId: string) => void;
  markCommitted: (courseId: string) => void;
}

export const useGeometryStatusStore = create<GeometryStatusState>()((set, get) => ({
  building: {},
  completions: 0,

  markBuilding: (courseId) => {
    if (!courseId || get().building[courseId]) return;   // no redundant renders
    set((s) => ({ building: { ...s.building, [courseId]: true } }));
  },

  /**
   * Completion bumps `completions` EVEN IF the course wasn't marked building — a build that finishes
   * is news to the UI regardless of how it started. Under-notifying here reproduces the exact bug
   * this store exists to fix, so it errs toward one extra render.
   */
  markDone: (courseId) => {
    set((s) => {
      const next = { ...s.building };
      delete next[courseId];
      return { building: next, completions: s.completions + 1 };
    });
  },

  /**
   * 2026-08-13, second pass — NEW GEOMETRY LANDED, independent of any build lifecycle.
   *
   * The original store wired the *build* (markBuilding/markDone) and missed the path that actually
   * runs most often. `fetchCourseGeometry` is stale-while-revalidate: a persisted entry older than a
   * week is returned IMMEDIATELY and the real refresh is fired detached (`void
   * refreshGeometryInBackground`). So the outer promise settles — and markDone fires — carrying the
   * STALE geometry. Seconds later the refresh calls commitGeometry with the fresh greens and, before
   * this, told nobody. Same defect as the one this store was created to fix, one layer down, and on
   * the path a RETURNING player takes every time: any course last seen more than 7 days ago.
   *
   * markDone couldn't be reused here — it clears `building`, and a background refresh is not the
   * in-flight build. Firing it would lift the BUILDING badge while a real build was still running.
   * This bumps `completions` only: re-derive everything geometry-shaped, touch no build state.
   *
   * Called from commitGeometry — the single point where new geometry enters the cache — so every
   * writer notifies by construction rather than by remembering to.
   */
  markCommitted: () => {
    set((s) => ({ completions: s.completions + 1 }));
  },
}));

/** Non-reactive read, for services and other non-React callers. */
export function isBuildingSnapshot(courseId: string | null | undefined): boolean {
  return !!courseId && !!useGeometryStatusStore.getState().building[courseId];
}
