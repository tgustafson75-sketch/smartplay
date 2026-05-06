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
 * Mapping shape — supports both forms Golfbert exposes:
 *   golfbertCourseId — fetches all 18 holes in one call. Cheaper, but
 *     requires you know the upstream course id (not always exposed in
 *     the public Golfbert UI; sometimes only individual hole pages are).
 *   golfbertHoleIds — explicit list of hole ids. Use when you only have
 *     hole-level URLs (e.g. https://golfbert.com/courses/holes/17345).
 *     Fetcher loops the list, deriving hole_number from each response.
 *
 * Either form (or both) is fine. If both are set, the courseId path
 * wins (single fetch). If neither, no mapping → existing geometry.
 */
export interface GolfbertMapping {
  golfbertCourseId?: string;
  golfbertHoleIds?: readonly (string | number)[];
}

export const LOCAL_COURSE_TO_GOLFBERT: Record<string, GolfbertMapping> = {
  // Tim's Golfbert paid access — Menifee Lakes Palms.
  // Seeded with hole 17345 (the URL Tim provided). Add more hole ids
  // as you collect them from Golfbert (one URL per hole), or replace
  // with golfbertCourseId once you find the parent course id.
  'local:palms': {
    golfbertHoleIds: [17345],
  },
};

/** Returns the Golfbert mapping for a SmartPlay course id, or null when
 *  no mapping exists (caller falls back to existing geometry). */
export function getGolfbertMapping(smartplayCourseId: string | null | undefined): GolfbertMapping | null {
  if (!smartplayCourseId) return null;
  const m = LOCAL_COURSE_TO_GOLFBERT[smartplayCourseId];
  if (!m) return null;
  if (!m.golfbertCourseId && (!m.golfbertHoleIds || m.golfbertHoleIds.length === 0)) return null;
  return m;
}

/** Back-compat helper — returns just the courseId string (used by
 *  callers that only want the bulk-fetch path). Returns null for
 *  hole-list-only mappings or no-mapping. */
export function getGolfbertCourseId(smartplayCourseId: string | null | undefined): string | null {
  const m = getGolfbertMapping(smartplayCourseId);
  return m?.golfbertCourseId ?? null;
}

/** True if the given course has any Golfbert mapping (course or hole list). */
export function hasGolfbertCourseMapping(smartplayCourseId: string | null | undefined): boolean {
  return getGolfbertMapping(smartplayCourseId) !== null;
}
