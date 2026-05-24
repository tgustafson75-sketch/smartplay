/**
 * 2026-05-24 — Course green ground-truth store.
 *
 * Persists "true center" green coordinates the user has surveyed
 * on-foot via the CourseTruth dev screen (app/dev/CourseTruth.tsx).
 * Read by yardage / SmartFinder consumers as the highest-priority
 * source when present — wins over Mark Green override, courseHoles,
 * and geometry cache. Each entry is a single AsyncStorage key:
 *
 *   truth_<courseId>_<hole>  →  '{"lat":N,"lng":N,"savedAt":N}'
 *
 * AsyncStorage was chosen over the existing courseHoles store so
 * survey data is decoupled from cached API data (golfcourseapi /
 * golfbert) — flushing the cache won't erase ground truth. Cloud
 * sync of these keys is a follow-up; for now they're device-local.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export type LatLng = { lat: number; lng: number };
export type CourseTruthEntry = LatLng & { savedAt: number };

function key(courseId: string, hole: number): string {
  return `truth_${courseId}_${hole}`;
}

// 2026-05-24 — In-memory cache of saved truth coords. Hydrated at app
// boot (hydrateCourseTruthCache below), kept in sync by setCourseTruth
// / clearCourseTruth. Enables a SYNC lookup inside the existing
// resolveGreenCoords chain in smartFinderService.ts — going async would
// have rippled through 4 callers and the distance-yards math the spec
// explicitly told us not to touch.
const truthCache: Map<string, LatLng> = new Map();
function cacheKey(courseId: string, hole: number): string {
  return `${courseId}_${hole}`;
}

/**
 * Read the surveyed truth coord for a hole. Returns null when no
 * truth has been saved for this courseId+hole pair.
 */
export async function getCourseTruth(courseId: string, hole: number): Promise<LatLng | null> {
  try {
    const raw = await AsyncStorage.getItem(key(courseId, hole));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CourseTruthEntry>;
    if (typeof parsed.lat !== 'number' || typeof parsed.lng !== 'number') return null;
    return { lat: parsed.lat, lng: parsed.lng };
  } catch (e) {
    console.log('[courseTruth] read failed:', e);
    return null;
  }
}

/**
 * Save (or overwrite) the surveyed truth coord for a hole. Updates
 * both AsyncStorage (durable) and the in-memory cache (sync lookup).
 */
export async function setCourseTruth(courseId: string, hole: number, coord: LatLng): Promise<void> {
  const entry: CourseTruthEntry = { lat: coord.lat, lng: coord.lng, savedAt: Date.now() };
  await AsyncStorage.setItem(key(courseId, hole), JSON.stringify(entry));
  truthCache.set(cacheKey(courseId, hole), { lat: coord.lat, lng: coord.lng });
}

/**
 * Synchronous lookup against the in-memory cache. Used by
 * resolveGreenCoords (smartFinderService.ts) at the top of the resolver
 * chain — TRUTH wins over Mark Green override, courseHoles, and
 * geometryCache. Returns null when no truth has been hydrated for this
 * courseId+hole pair (call hydrateCourseTruthCache at boot first).
 */
export function getCourseTruthSync(courseId: string, hole: number): LatLng | null {
  return truthCache.get(cacheKey(courseId, hole)) ?? null;
}

/**
 * One-shot hydration of the in-memory cache from AsyncStorage. Called
 * once at app boot from app/_layout.tsx. Scans all `truth_*` keys with
 * a single multiGet, populates the cache, and logs a count. Failures
 * are non-fatal — the chain falls through to the existing API sources.
 */
export async function hydrateCourseTruthCache(): Promise<void> {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const truthKeys = allKeys.filter((k) => k.startsWith('truth_'));
    if (truthKeys.length === 0) {
      console.log('[courseTruth] hydrate: no saved truth coords yet');
      return;
    }
    const pairs = await AsyncStorage.multiGet(truthKeys);
    let loaded = 0;
    for (const [k, raw] of pairs) {
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as Partial<CourseTruthEntry>;
        if (typeof parsed.lat !== 'number' || typeof parsed.lng !== 'number') continue;
        // 'truth_<courseId>_<hole>' → '<courseId>_<hole>'
        const id = k.slice('truth_'.length);
        truthCache.set(id, { lat: parsed.lat, lng: parsed.lng });
        loaded++;
      } catch {
        // skip malformed entry — don't poison the whole hydration
      }
    }
    console.log(`[courseTruth] hydrated ${loaded} truth coord(s)`);
  } catch (e) {
    console.log('[courseTruth] hydrate failed:', e);
  }
}

/**
 * Read the full entry (with savedAt timestamp) — useful for the dev
 * screen to show "last saved Xm ago" without a separate read.
 */
export async function getCourseTruthEntry(courseId: string, hole: number): Promise<CourseTruthEntry | null> {
  try {
    const raw = await AsyncStorage.getItem(key(courseId, hole));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CourseTruthEntry>;
    if (typeof parsed.lat !== 'number' || typeof parsed.lng !== 'number' || typeof parsed.savedAt !== 'number') return null;
    return { lat: parsed.lat, lng: parsed.lng, savedAt: parsed.savedAt };
  } catch {
    return null;
  }
}

/**
 * Remove the saved truth for a hole. Used by the dev screen's "clear"
 * affordance so a misclick doesn't permanently corrupt the survey.
 */
export async function clearCourseTruth(courseId: string, hole: number): Promise<void> {
  await AsyncStorage.removeItem(key(courseId, hole));
  truthCache.delete(cacheKey(courseId, hole));
}
