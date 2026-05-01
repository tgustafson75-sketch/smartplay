import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ShotLocation } from '../store/roundStore';

/**
 * Phase B — Course geometry fetch and cache.
 *
 * The current upstream (golfcourseapi.com) only exposes per-hole *points*: tee location and
 * green front/middle/back. Polygon data (fairway centerlines, green outlines, hazard
 * polygons) is not available. The HoleGeometry contract here is shaped so richer sources
 * can populate it later without migration:
 *
 *   - `tee` and `green` are always populated when the upstream returns lat/lng.
 *   - `green_front` / `green_back` carry the depth axis for distance-to-green calculations.
 *   - `bearing_deg` is computed from tee → green and used to orient HoleShotMap.
 *   - `hazards` carries the textual labels we already extract; positions stay null until
 *     a richer data source lands (Phase D / 1.x course-detail surface).
 *   - `fairway_centerline` and `green_outline` are reserved arrays — empty in B, populated
 *     by future imports.
 */

export type HoleGeometry = {
  hole_number: number;
  par: number;
  yardage: number;
  tee: ShotLocation | null;
  green: ShotLocation | null;
  green_front: ShotLocation | null;
  green_back: ShotLocation | null;
  bearing_deg: number | null;
  hazards: { label: string; location: ShotLocation | null }[];
  fairway_centerline: ShotLocation[]; // reserved for richer geometry source
  green_outline: ShotLocation[];      // reserved for richer geometry source
};

export type CourseGeometry = {
  course_id: string;
  course_name: string;
  fetched_at: number;
  holes: HoleGeometry[];
};

const CACHE_KEY_PREFIX = 'course-geometry-v1::';
const REFRESH_AFTER_MS = 7 * 24 * 60 * 60 * 1000; // weekly maximum

const memCache: Map<string, CourseGeometry> = new Map();

function cacheKey(courseId: string): string {
  return CACHE_KEY_PREFIX + courseId;
}

/** Synchronous cache read — returns the in-memory copy if present, else null. */
export function getCachedGeometry(courseId: string): CourseGeometry | null {
  return memCache.get(courseId) ?? null;
}

/** Returns a single hole's geometry from cache, or null if not loaded. */
export function getHoleGeometry(courseId: string, holeNumber: number): HoleGeometry | null {
  const c = memCache.get(courseId);
  return c?.holes.find(h => h.hole_number === holeNumber) ?? null;
}

async function readPersistedCache(courseId: string): Promise<CourseGeometry | null> {
  try {
    const raw = await AsyncStorage.getItem(cacheKey(courseId));
    if (!raw) return null;
    return JSON.parse(raw) as CourseGeometry;
  } catch {
    return null;
  }
}

async function writePersistedCache(geo: CourseGeometry): Promise<void> {
  try {
    await AsyncStorage.setItem(cacheKey(geo.course_id), JSON.stringify(geo));
  } catch (e) {
    console.warn('[courseGeometry] cache write failed:', e);
  }
}

/**
 * Fetch course geometry, returning a cached copy if it's fresh (<7 days). Falls back to a
 * stale cached copy if the network fetch fails. Returns null only when no data is
 * available at all.
 */
export async function fetchCourseGeometry(courseId: string): Promise<CourseGeometry | null> {
  if (!courseId) return null;

  const memHit = memCache.get(courseId);
  if (memHit && Date.now() - memHit.fetched_at < REFRESH_AFTER_MS) return memHit;

  const persisted = await readPersistedCache(courseId);
  if (persisted) {
    memCache.set(courseId, persisted);
    if (Date.now() - persisted.fetched_at < REFRESH_AFTER_MS) return persisted;
  }

  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';
  const url = `${apiUrl}/api/course-geometry?courseId=${encodeURIComponent(courseId)}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) {
      console.warn('[courseGeometry] fetch failed:', res.status);
      return persisted ?? null;
    }
    const geo = (await res.json()) as CourseGeometry;
    geo.fetched_at = Date.now();
    memCache.set(courseId, geo);
    await writePersistedCache(geo);
    return geo;
  } catch (e) {
    console.warn('[courseGeometry] fetch exception:', e);
    return persisted ?? null;
  }
}

/** Test/debug only. */
export function _clearGeometryCache(): void {
  memCache.clear();
}
