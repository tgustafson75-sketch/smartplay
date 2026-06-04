/**
 * 2026-05-26 — Fix AV: Nearest local course detector.
 *
 * Tim: "if that second intro message could incorporate and would
 * also verify our GPS is working, I see you're at, and then whatever
 * course the user is at, would you like to start a round? would...
 * that would be doubly cool as well as, uh, for us, the marked
 * verification point. But if it doesn't work, they select the play
 * tab's like the course, and then we get the point as a second
 * backup."
 *
 * Reads a one-shot GPS fix and matches it against LOCAL_COURSE_CENTROIDS.
 * Returns the closest course within RADIUS_M (default 800m — generous
 * enough for parking lot + clubhouse, tight enough to avoid neighborhood
 * false positives), or null when:
 *   - GPS permission denied / not available
 *   - GPS fix unavailable
 *   - No course within radius
 *
 * Pure read — no side effects, no store mutation. Caller decides what
 * to do with the result (Caddie tab uses it for the spoken second
 * intro; future surfaces may use it for auto-prefill).
 */

import { getOneShotFix } from './gpsManager';
import { haversineMeters } from '../utils/geoDistance';
import { LOCAL_COURSE_CENTROIDS, type LocalCourseSlug } from '../data/localCourseImages';

const SLUG_DISPLAY_NAMES: Record<LocalCourseSlug, string> = {
  'palms':            'Menifee Lakes — Palms',
  'lakes':            'Menifee Lakes — Lakes',
  'rancho-california':'Rancho California',
  'crystal-springs':  'Crystal Springs',
  'mariners-point':   'Mariners Point',
  'san-jose-muni':    'San Jose Municipal',
  'sunnyvale':        'Sunnyvale Golf Course',
  'journey-at-pechanga': 'Journey at Pechanga',
  'westlake-cc-nj':   'Westlake Country Club',
  'echo-hills':       'Echo Hills Golf Course',
};

/** Friendly spoken short-name — strips parent-course parens for TTS. */
const SLUG_SPOKEN_NAMES: Record<LocalCourseSlug, string> = {
  'palms':            'the Palms',
  'lakes':            'the Lakes',
  'rancho-california':'Rancho California',
  'crystal-springs':  'Crystal Springs',
  'mariners-point':   'Mariners Point',
  'san-jose-muni':    'San Jose Muni',
  'sunnyvale':        'Sunnyvale',
  'journey-at-pechanga': 'Journey at Pechanga',
  'westlake-cc-nj':   'Westlake',
  'echo-hills':       'Echo Hills',
};

export interface NearestCourseResult {
  slug: LocalCourseSlug;
  /** Internal course id (e.g. 'local:palms') used by Play-tab routing. */
  id: string;
  /** Long display name for visual surfaces. */
  displayName: string;
  /** Short name suitable for TTS playback. */
  spokenName: string;
  distanceMeters: number;
}

export interface DetectNearestCourseOpts {
  /** Match radius in meters. Default 800 (covers a typical course
   *  property including parking + clubhouse). */
  radiusMeters?: number;
  /** Max age of the cached GPS fix before re-pulsing. Default 30s —
   *  the second-intro path is happy with a slightly stale fix; we
   *  don't need a fresh hardware read every app launch. */
  maxFixAgeMs?: number;
}

export async function detectNearestLocalCourse(
  opts: DetectNearestCourseOpts = {},
): Promise<NearestCourseResult | null> {
  const radius = opts.radiusMeters ?? 800;
  const maxAge = opts.maxFixAgeMs ?? 30_000;

  const fix = await getOneShotFix({ maxAgeMs: maxAge });
  if (!fix) return null;

  let best: { slug: LocalCourseSlug; meters: number } | null = null;
  for (const [slug, centroid] of Object.entries(LOCAL_COURSE_CENTROIDS) as [LocalCourseSlug, { lat: number; lng: number }][]) {
    const meters = haversineMeters(
      { lat: fix.lat, lng: fix.lng },
      centroid,
    );
    if (meters > radius) continue;
    if (!best || meters < best.meters) {
      best = { slug, meters };
    }
  }

  if (!best) return null;

  return {
    slug: best.slug,
    id: `local:${best.slug}`,
    displayName: SLUG_DISPLAY_NAMES[best.slug],
    spokenName: SLUG_SPOKEN_NAMES[best.slug],
    distanceMeters: Math.round(best.meters),
  };
}
