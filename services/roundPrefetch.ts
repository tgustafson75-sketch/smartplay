/**
 * 2026-06-06 — Phase 2 of on-course resilience sprint.
 *
 * One concern: when a round starts, pre-warm every per-course cache so
 * the round survives offline. Tim's Echo Hills round dropped cellular
 * mid-round and any data that needed a network fetch (hole notes,
 * geometry refresh) silently failed; SmartVision / Caddie / brain
 * context all suffered the same root cause.
 *
 * Fix model: fire fetchCourseGeometry + fetchCourseContent in parallel
 * the moment startRound() commits. Each underlying service already has
 * its own AsyncStorage cache + stale-while-revalidate semantics; the
 * orchestrator's job is purely to NUDGE those caches at the moment
 * signal is most likely to be good (round start, typically still in
 * the parking lot / clubhouse).
 *
 * Behavior contract:
 *   - Fire-and-forget. Never throws. Never blocks startRound's UX.
 *   - Idempotent. Underlying services skip refetch when cache fresh.
 *   - Silent on failure. Failed prefetch leaves cache as-is; on-demand
 *     fetch later will try again if user opens the relevant surface.
 *   - Logs progress + outcome to console so /owner-logs (which surfaces
 *     console errors and silent fails) shows the prefetch trail at the
 *     start of every round.
 *
 * NOT prefetched here:
 *   - Mapbox satellite tiles — OS Image cache handles per-screen warmup.
 *   - Brain replies — dynamic per turn (Phase 3 will add a local
 *     responder for status queries).
 *   - TTS — handled by Phase 1's device-TTS fallback in speak() catch.
 *   - Landmarks — bundled via require() in services/holeContextResolver,
 *     always available offline.
 */

import { fetchCourseGeometry } from './courseGeometryService';
import { fetchCourseContent } from './courseContentService';
import { fetchCourseIntelligence } from './courseIntelligenceService';
import type { CourseHole } from '../store/roundStore';

type PrefetchArgs = {
  courseId: string;
  courseName: string;
  courseLocation?: { lat: number; lng: number } | null;
  holes: CourseHole[];
  rating?: string | number | null;
  slope?: string | number | null;
};

/**
 * Run the prefetch chain for a freshly-started round. Fire-and-forget
 * from store/roundStore.startRound — don't await.
 */
export async function prefetchRoundData(args: PrefetchArgs): Promise<void> {
  const { courseId, courseName, courseLocation, holes, rating, slope } = args;
  if (!courseId || !courseName || !Array.isArray(holes) || holes.length === 0) {
    console.log('[roundPrefetch] skipped — missing courseId / courseName / holes', { courseId, courseName, holesLen: holes?.length ?? 0 });
    return;
  }
  console.log('[roundPrefetch] starting for', courseId, '— holes:', holes.length);
  const startedAt = Date.now();

  // Derive aggregate par + total yardage from the holes array. These
  // feed the /api/course-content request shape so the server can build
  // course-aware copy without an extra round-trip.
  const par = holes.reduce((sum, h) => sum + (typeof h.par === 'number' ? h.par : 0), 0);
  const yardage = holes.reduce((sum, h) => sum + (typeof h.distance === 'number' ? h.distance : 0), 0);
  const ratingNum = typeof rating === 'number' ? rating : (typeof rating === 'string' && rating.trim() ? Number(rating) : null);
  const slopeNum = typeof slope === 'number' ? slope : (typeof slope === 'string' && slope.trim() ? Number(slope) : null);

  const geometryP = fetchCourseGeometry(courseId, { courseLocation: courseLocation ?? null })
    .then((g) => {
      console.log('[roundPrefetch] geometry done for', courseId, '— holes cached:', g?.holes?.length ?? 0);
    })
    .catch((e) => {
      console.log('[roundPrefetch] geometry failed (non-fatal):', e instanceof Error ? e.message : String(e));
    });

  const contentP = fetchCourseContent({
    courseId,
    courseName,
    par,
    yardage,
    rating: Number.isFinite(ratingNum as number) ? (ratingNum as number) : null,
    slope: Number.isFinite(slopeNum as number) ? (slopeNum as number) : null,
    holes: holes.map(h => ({
      hole_number: h.hole,
      par: h.par,
      yardage: typeof h.distance === 'number' ? h.distance : 0,
    })),
  })
    .then((c) => {
      console.log('[roundPrefetch] content done for', courseId, '— hole_notes:', c?.hole_notes?.length ?? 0, 'descriptions:', c?.hole_descriptions?.length ?? 0);
    })
    .catch((e) => {
      console.log('[roundPrefetch] content failed (non-fatal):', e instanceof Error ? e.message : String(e));
    });

  // 2026-06-06 — Phase 2.5: also fetch the web-search-grounded
  // course intelligence brief. Same fire-and-forget contract —
  // never throws. Result lives in services/courseIntelligenceService's
  // in-memory mirror + AsyncStorage cache, consumed by
  // hooks/useVoiceCaddie's brain-call context builder.
  const courseLocStr = courseLocation
    ? `${courseLocation.lat.toFixed(4)},${courseLocation.lng.toFixed(4)}`
    : '';
  const intelP = fetchCourseIntelligence({
    courseId,
    courseName,
    location: courseLocStr,
  })
    .then((r) => {
      console.log('[roundPrefetch] intelligence done for', courseId, '— source:', r.source, 'chars:', r.intelligence?.length ?? 0);
    })
    .catch((e) => {
      console.log('[roundPrefetch] intelligence failed (non-fatal):', e instanceof Error ? e.message : String(e));
    });

  await Promise.allSettled([geometryP, contentP, intelP]);
  console.log('[roundPrefetch] complete for', courseId, '— elapsed', Date.now() - startedAt, 'ms');
}
