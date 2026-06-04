/**
 * SmartPlay course id → Golfbert course id mapping.
 *
 * Tim purchased Golfbert API access for ONE course (Menifee Lakes Palms).
 * This table maps our internal `course_id` (the same id that flows
 * through CoursePicker, /course/[course_id], roundStore, etc) to the
 * upstream Golfbert course id, so SmartVision and the lie-aware caddie
 * can opportunistically pull richer geometry (green polygons, bunker
 * outlines, fairway shape, hazard rings) when available.
 *
 * Behavior:
 *   - If the lookup returns a Golfbert id, we hit /api/golfbert-proxy
 *     for the richer data and overlay it on top of the Mapbox satellite
 *     tile (current SmartVision render).
 *   - If the lookup returns null OR the Golfbert proxy errors (no API
 *     key configured on Vercel, network fail, etc), the app falls back
 *     to the golfcourseapi point-only geometry — no functional regression.
 *
 * To add a course:
 *   1. Look up the course on Golfbert's web UI (golfbert.com).
 *   2. Read the course id from the URL (e.g. /courses/19103/...) or
 *      from the API search response.
 *   3. Add the entry below mapped to your SmartPlay course_id.
 *
 * Local courses use the `local:slug` form (e.g. `local:palms` resolves
 * to Menifee Lakes Palms via the slug→friendly-name lookup in
 * app/course/[course_id].tsx).
 */

/**
 * Mapping shape — Golfbert course id only. Fetches all 18 holes in one
 * call via /api/golfbert-proxy?action=holes&id={courseId}. Lakes is not
 * yet mapped (separate paid unlock needed).
 */
export interface GolfbertMapping {
  golfbertCourseId: string;
}

export const LOCAL_COURSE_TO_GOLFBERT: Record<string, GolfbertMapping> = {
  // Tim's Golfbert paid access — Menifee Lakes Palms. 17345 is the
  // upstream Golfbert courseId (confirmed via action=course audit
  // 2026-06-03 — returns "Menifee Lakes Country Club (Palms course)").
  'local:palms': {
    golfbertCourseId: '17345',
  },
};

/** Returns the Golfbert mapping for a SmartPlay course id, or null when
 *  no mapping exists (caller falls back to existing geometry). */
export function getGolfbertMapping(smartplayCourseId: string | null | undefined): GolfbertMapping | null {
  if (!smartplayCourseId) return null;
  const m = LOCAL_COURSE_TO_GOLFBERT[smartplayCourseId];
  if (!m) return null;
  if (!m.golfbertCourseId) return null;
  return m;
}

/** Returns just the courseId string for callers that only want the id. */
export function getGolfbertCourseId(smartplayCourseId: string | null | undefined): string | null {
  const m = getGolfbertMapping(smartplayCourseId);
  return m?.golfbertCourseId ?? null;
}

/** True if the given course has a Golfbert mapping. */
export function hasGolfbertCourseMapping(smartplayCourseId: string | null | undefined): boolean {
  return getGolfbertMapping(smartplayCourseId) !== null;
}
