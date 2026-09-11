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
 *   - TTS — Phase 1's device-TTS fallback was reverted (see
 *     phase1-device-tts-crash memory). speak() catch is the d06e37f-
 *     shape (clean cleanup + log) until expo-speech rebuilds with
 *     the native module bundled. Until then, voice output relies on
 *     /api/voice; offline = silent on first reply.
 *   - Landmarks — bundled via require() in services/holeContextResolver,
 *     always available offline.
 */

import { fetchCourseGeometry, getHoleGeometry, loadDerivedGeometry, mappedHoleCount } from './courseGeometryService';
import { fetchCourseContent } from './courseContentService';
import { fetchCourseIntelligence } from './courseIntelligenceService';
import { prefetchHoles, isMapboxConfigured, type HoleImageryInput } from './mapboxImagery';
import type { CourseHole } from '../store/roundStore';
import { isValidGolfCoord } from '../utils/coordGuard';

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
 *
 * 2026-09-10 — resolves with the number of holes that ended up with a GREEN, so the caller can tell
 * a course that built from one that merely finished. Zero is a usable course with no measured
 * yardage to the pin; it is not a failure to download, but it is never a success to report.
 */
export async function prefetchRoundData(args: PrefetchArgs): Promise<number> {
  const { courseId, courseName, courseLocation, holes, rating, slope } = args;
  if (!courseId || !courseName || !Array.isArray(holes) || holes.length === 0) {
    console.log('[roundPrefetch] skipped — missing courseId / courseName / holes', { courseId, courseName, holesLen: holes?.length ?? 0 });
    return 0;
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

  /**
   * 2026-09-10 — hydrate the AI-DERIVED greens too, not just the API/OSM ones.
   *
   * deriveHoleGeometry persists a green for exactly the courses golfcourseapi and OSM have none for,
   * but loadDerivedGeometry was called from ONE place: SmartVision's mount. So a green the app had
   * already solved and stored was invisible to yardages, the caddie's working number and hole
   * detection for any round where the player never opened the map. Hydrating here costs one
   * AsyncStorage read and makes the derived tier of resolveGreenCoords reachable.
   */
  void loadDerivedGeometry(courseId).catch(() => undefined);

  /**
   * 2026-09-10 (Tim, Hemet: "the course engine spun and loaded and I got what I thought was the
   * course" — then no yardage for eighteen holes) — A BUILD THAT PRODUCED NO GREENS REPORTED SUCCESS.
   *
   * This logged `holes cached: N` and swallowed every failure as non-fatal, and downloadCourse then
   * marked the course DOWNLOADED regardless. So a course whose geometry build returned nothing was
   * indistinguishable from one that worked — and nothing ever went back for it. `courseToHoles`
   * writes literal zeros into every green coordinate for a golfcourseapi course, so with no cached
   * geometry there is no green ANYWHERE in the cascade: yardage silently degrades to hole-length
   * minus distance-walked for the whole round, hole advance holds on "no current-hole green
   * geometry", and Refresh GPS says it has nothing.
   *
   * Two things change. Holes cached is not the measure — GREENS are (`mappedHoleCount` counts holes
   * that actually carry one; `cacheIsServable` already refuses to serve a zero-green cache, so
   * "cached" can mean "cached and useless"). And a zero-green result is RETRIED once, because it is
   * usually transient: the engine fans out to golfcourseapi plus Overpass, and Overpass throttles.
   * Measured against production on 2026-09-10, a healthy build of Tim's own course returns 18/18
   * greens in 3.2 seconds — so one retry is cheap relative to losing the round.
   *
   * Still non-fatal: a course with no greens must still download and play, degraded and honest. The
   * difference is that we now KNOW, and say so. [[state-what-you-measured-not-what-you-intended]]
   */
  const geometryP = (async (): Promise<number> => {
    const build = async () => {
      const g = await fetchCourseGeometry(courseId, { courseLocation: courseLocation ?? null });
      return mappedHoleCount(g);
    };
    try {
      let greens = await build();
      if (greens === 0) {
        console.log('[roundPrefetch] geometry returned ZERO greens for', courseId, '— retrying once');
        try { greens = await build(); } catch { /* keep the zero and report it */ }
      }
      console.log('[roundPrefetch] geometry done for', courseId, '— greens mapped:', greens);
      return greens;
    } catch (e) {
      console.log('[roundPrefetch] geometry failed (non-fatal):', e instanceof Error ? e.message : String(e));
      return 0;
    }
  })();

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

  // 2026-06-07 — Mapbox tile prefetch for all 18 holes so SmartVision
  // Mode 1 (satellite tile) is fully offline-safe mid-round even on
  // first-visit holes. Previously fetchHoleImagery cached opportunistically
  // per-screen-mount; a first-time visit to a hole with no cell would
  // show a blank canvas. Tile cache lives in expo-file-system; each
  // tile is 50-150 KB, so 18 holes ≈ 1-3 MB.
  // Fire-and-forget after the geometry/content fetches because tile
  // prefetch wants the green/tee lat/lngs from courseGeometry that
  // may have come in via geometryP.
  let tileP: Promise<unknown> = Promise.resolve();
  if (isMapboxConfigured()) {
    // 2026-06-07 (audit) — build tile inputs AFTER geometry resolves and
    // source coords from the loaded geometry first. Previously tileInputs
    // was built synchronously from the (possibly coord-less) `holes` param
    // before geometryP settled, so first-visit holes were skipped → blank
    // satellite canvas offline mid-round.
    tileP = geometryP
      .then(() => {
        const tileInputs = buildTileInputs(courseId, holes);
        if (tileInputs.length === 0) {
          console.log('[roundPrefetch] mapbox skipped — no holes have full tee+green coords');
          return;
        }
        return prefetchHoles(tileInputs).then(() => {
          console.log('[roundPrefetch] mapbox tiles prefetched for', courseId, '— count:', tileInputs.length);
        });
      })
      .catch((e) => {
        console.log('[roundPrefetch] mapbox prefetch failed (non-fatal):', e instanceof Error ? e.message : String(e));
      });
  }

  await Promise.allSettled([geometryP, contentP, intelP, tileP]);
  const greens = await geometryP.catch(() => 0);
  console.log('[roundPrefetch] complete for', courseId, '— elapsed', Date.now() - startedAt, 'ms', '— greens:', greens);
  /**
   * 2026-09-10 — a course with no greens is the single fact that most changes how a round will go,
   * so it goes in the field-test trace by name. Without it the report can only observe the
   * CONSEQUENCE ("hole 7 never resolved a green") and not the cause ("the build came back empty
   * before you teed off").
   */
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const rt = require('./roundTrace') as typeof import('./roundTrace');
    rt.trace('course', 'geometry', { courseId, greens, holes: holes.length });
  } catch { /* tracing never blocks a prefetch */ }
  return greens;
}

// Courses whose SmartVision imagery we've already warmed this session, so
// tapping through the course list doesn't re-fire geometry + 18 tiles every
// time. Cleared on app restart (module lifetime).
const imageryWarmed = new Set<string>();

// Minimal hole shape the tile builder needs. CourseHole satisfies it; API/searched
// courses can pass just {hole,par,distance} and rely on getHoleGeometry for coords.
type TileHole = {
  hole: number;
  par: number;
  distance: number;
  teeLat?: number;
  teeLng?: number;
  middleLat?: number;
  middleLng?: number;
};

/** Build Mapbox tile inputs for every hole that has (or can fall back to) tee+green coords. */
function buildTileInputs(courseId: string, holes: TileHole[]): HoleImageryInput[] {
  return holes
    .map((h) => {
      const geo = getHoleGeometry(courseId, h.hole);
      /**
       * 2026-09-10 — `typeof h.middleLat === 'number'` was the whole check, and ZERO IS A NUMBER.
       *
       * courseToHoles writes `middleLat: 0, middleLng: 0` for every hole of every golfcourseapi
       * course (the free tier ships tees and null greens), so this built `{ lat: 0, lng: 0 }` — a
       * truthy object, which sails past `if (!tee || !green)`. Every such course then requested
       * eighteen Mapbox satellite tiles of NULL ISLAND in the Gulf of Guinea, cached them as that
       * course's hole imagery, and burned the tile quota doing it.
       *
       * utils/coordGuard is the single owner of "is this a real course coordinate", and its own
       * header says to apply it at every boundary where coordinates enter the pipeline — this is
       * one, and it was missed. [[two-owners-is-the-root-cause]]
       */
      const tee = geo?.tee ?? (isValidGolfCoord(h.teeLat, h.teeLng) ? { lat: h.teeLat, lng: h.teeLng } : null);
      const green = geo?.green ?? (isValidGolfCoord(h.middleLat, h.middleLng) ? { lat: h.middleLat, lng: h.middleLng } : null);
      if (!tee || !green) return null;
      if (!isValidGolfCoord(tee.lat, tee.lng) || !isValidGolfCoord(green.lat, green.lng)) return null;
      return {
        courseId,
        holeNumber: h.hole,
        par: h.par,
        yardage: typeof h.distance === 'number' ? h.distance : 350,
        tee,
        green,
      } as HoleImageryInput;
    })
    .filter((x): x is HoleImageryInput => x != null);
}

/**
 * 2026-07-23 (Tim — "build hole images on demand as the user selects a course").
 *
 * Lighter sibling of prefetchRoundData: when a course is SELECTED (not yet
 * started), warm just the SmartVision visual layer — course geometry + the
 * per-hole satellite tiles — and persist it so the hole maps are instantly
 * ready (and offline) before the round even begins. Skips the heavier
 * brain-context fetches (content/intelligence); those stay at round start.
 *
 * Idempotent per session (imageryWarmed guard) so scrolling/tapping through
 * the course list doesn't re-fire. Fire-and-forget; never throws.
 *
 * Note on AI-vision derivation: holes with NO coords (a fully-unknown searched
 * course) are skipped here — deriving a distinct green per hole needs a rough
 * per-hole seed, which we don't have from a single centroid. That fill lands
 * with the Course Cloud crowd-source step (per-hole seeds + shared DB).
 */
export async function prefetchCourseImagery(args: {
  courseId: string;
  courseName: string;
  courseLocation?: { lat: number; lng: number } | null;
  holes: TileHole[];
}): Promise<void> {
  const { courseId, courseName, courseLocation, holes } = args;
  if (!courseId || !Array.isArray(holes) || holes.length === 0) return;
  if (imageryWarmed.has(courseId)) return;
  imageryWarmed.add(courseId);
  console.log('[roundPrefetch] imagery warm on select for', courseId, '— holes:', holes.length);

  try {
    await fetchCourseGeometry(courseId, { courseLocation: courseLocation ?? null }).catch(() => null);
    if (!isMapboxConfigured()) { imageryWarmed.delete(courseId); return; }
    const tileInputs = buildTileInputs(courseId, holes);
    if (tileInputs.length === 0) {
      // No coords yet (e.g. offline/geometry miss) — un-warm so a later selection can retry once
      // connectivity/geometry lands, instead of being stuck warmed for the whole session.
      imageryWarmed.delete(courseId);
      console.log('[roundPrefetch] imagery warm skipped — no holes have tee+green coords yet:', courseId);
      return;
    }
    await prefetchHoles(tileInputs);
    console.log('[roundPrefetch] imagery warm done for', courseId, '— tiles:', tileInputs.length);
  } catch (e) {
    // Un-warm so a later selection can retry after a transient failure.
    imageryWarmed.delete(courseId);
    console.log('[roundPrefetch] imagery warm failed (non-fatal):', e instanceof Error ? e.message : String(e), courseName);
  }
}
