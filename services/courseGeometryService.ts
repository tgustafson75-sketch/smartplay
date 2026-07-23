import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ShotLocation } from '../store/roundStore';
import { LOCAL_COURSE_CENTROIDS, type LocalCourseSlug } from '../data/localCourseImages';
import { getApiBaseUrl } from './apiBase';

// 2026-05-17 — Known hole count per local course. Passed to the
// /api/course-geometry endpoint so the OSM-Overpass fallback can cap
// emitted holes correctly (Mariners is 9-hole par-3; without the cap
// the server emits 9 real + practice green ghost holes). Defaults to
// 18 when the slug isn't known.
const LOCAL_COURSE_HOLE_COUNT: Record<string, number> = {
  'palms': 18,
  'lakes': 18,
  'rancho-california': 18,
  'crystal-springs': 18,
  'mariners-point': 9,
  'san-jose-muni': 18,
  'sunnyvale': 18,
  // 2026-05-28 — Westlake Country Club, Jackson NJ.
  'westlake-cc-nj': 18,
};

/**
 * 2026-05-16 — Local-course → golfcourseapi search hint table.
 *
 * Bundled "local:" courses don't have golfcourseapi IDs hardcoded
 * (and we can't ship them — Tim added Sunnyvale + San Jose Muni
 * empirically without knowing the IDs upstream). For those courses we
 * lazily resolve the upstream ID by running searchCourses() with a
 * tight hint string + optional city filter, picking the top match,
 * and caching the resolved ID.
 *
 * Why this exists: golfcourseapi free tier gives per-hole tee + front/
 * middle/back of green coords, which is everything SmartVision needs
 * to render per-hole Mapbox satellite tiles oriented along the
 * tee→green axis. Paid sources (Golfbert at $300/mo) only matter for
 * polygon data — fairway/green outlines — which we don't render yet.
 *
 * Adding a new "local:" course later is one line in this map.
 */
type LocalCourseHint = {
  /** Free-text search string passed to searchCourses() — the more
   *  specific, the better the match. Include city/state in the string
   *  if the bare course name is ambiguous. */
  search: string;
  /** Optional substring matched against each search result's
   *  `location` field to disambiguate when the top match is wrong
   *  (e.g. another "Sunnyvale GC" elsewhere). Lowercase. */
  expectedCity?: string;
};

const LOCAL_COURSE_API_HINTS: Record<string, LocalCourseHint> = {
  sunnyvale: { search: 'Sunnyvale Golf Course', expectedCity: 'sunnyvale' },
  'san-jose-muni': { search: 'San Jose Municipal Golf Course', expectedCity: 'san jose' },
  'rancho-california': { search: 'Rancho California Golf Club', expectedCity: 'temecula' },
  'crystal-springs': { search: 'Crystal Springs Golf Course', expectedCity: 'burlingame' },
  'mariners-point': { search: 'Mariners Point Golf Center', expectedCity: 'foster city' },
  // 2026-05-28 — Westlake Country Club, Jackson NJ. golfcourseapi
  // should resolve this on the first online visit; result cached
  // forever per the resolvedIdMem + AsyncStorage layer above.
  'westlake-cc-nj': { search: 'Westlake Country Club Jackson', expectedCity: 'jackson' },
  // 2026-06-08 — Final two stored courses linked to golfcourseapi. Both
  // 'lakes' and 'palms' are nines at Menifee Lakes Country Club (Menifee,
  // CA); the API lists the club once, so both resolve to that entry for
  // tee/green coords + yardages. Hole imagery stays course-specific via the
  // local image sets. Closes the last gap so every stored course links.
  lakes: { search: 'Menifee Lakes Country Club', expectedCity: 'menifee' },
  palms: { search: 'Menifee Lakes Country Club', expectedCity: 'menifee' },
};

const RESOLVED_ID_KEY_PREFIX = 'local-courseapi-id-v1::';
const resolvedIdMem: Map<string, string> = new Map();

async function readResolvedId(localSlug: string): Promise<string | null> {
  if (resolvedIdMem.has(localSlug)) return resolvedIdMem.get(localSlug)!;
  try {
    const v = await AsyncStorage.getItem(RESOLVED_ID_KEY_PREFIX + localSlug);
    if (v) resolvedIdMem.set(localSlug, v);
    return v;
  } catch {
    return null;
  }
}

async function writeResolvedId(localSlug: string, upstreamId: string): Promise<void> {
  resolvedIdMem.set(localSlug, upstreamId);
  try { await AsyncStorage.setItem(RESOLVED_ID_KEY_PREFIX + localSlug, upstreamId); } catch {}
}

/**
 * Resolve a "local:<slug>" courseId to its golfcourseapi upstream ID,
 * lazily searching the API on first call and caching the result.
 * Returns null when no hint exists or the search yields no usable
 * match — caller should fall back to centroid imagery in that case.
 */
async function resolveLocalCourseId(localSlug: string): Promise<string | null> {
  const cached = await readResolvedId(localSlug);
  if (cached) return cached;

  const hint = LOCAL_COURSE_API_HINTS[localSlug];
  if (!hint) {
    console.log('[courseGeometry] no API hint for local slug:', localSlug);
    return null;
  }

  try {
    const { searchCourses } = await import('./golfCourseApi');
    const results = await searchCourses(hint.search);
    // Skip the sentinel error result shape
    const real = results.filter(r => r.id && !r._error);
    if (real.length === 0) {
      console.log('[courseGeometry] no search hits for', hint.search);
      return null;
    }
    // 2026-06-08 (audit #1) — disambiguate by NAME first, then city. A
    // bare city-substring match could resolve to the wrong course when a
    // city has several courses ("San Jose Golf Course" vs "San Jose
    // Municipal"). Wrong id → wrong geometry/hazards/yardages cached for
    // every future lookup. Prefer exact/contained club-name match, then
    // name-token + city, then city only (legacy), then first.
    const searchLc = hint.search.toLowerCase();
    const cityLc = hint.expectedCity?.toLowerCase();
    const nameOf = (r: typeof real[number]) => (r.club_name ?? '').toLowerCase();
    const cityOf = (r: typeof real[number]) => (r.location ?? '').toLowerCase();
    const nameMatches = (r: typeof real[number]) => {
      // 2026-06-08 (audit #2) — dropped the bidirectional `searchLc.includes(n)`:
      // it let a too-short club_name ("Sunnyvale") match a longer hint and
      // pick the wrong course. Require the result name to CONTAIN the hint.
      const n = nameOf(r);
      return n.length > 0 && (n === searchLc || n.includes(searchLc));
    };
    const cityMatches = (r: typeof real[number]) => !!cityLc && cityOf(r).includes(cityLc);
    const top =
      real.find(r => nameOf(r) === searchLc) ??
      real.find(r => nameMatches(r) && cityMatches(r)) ??
      real.find(r => nameMatches(r)) ??
      (cityLc ? real.find(cityMatches) : undefined) ??
      real[0];
    if (!top?.id) return null;
    console.log('[courseGeometry] resolved', localSlug, '→', top.id, '(' + top.club_name + ')');
    await writeResolvedId(localSlug, top.id);
    return top.id;
  } catch (e) {
    console.warn('[courseGeometry] resolveLocalCourseId failed:', e);
    return null;
  }
}

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

// 2026-05-17 — Polygon support for Bluegolf-class hole rendering.
// OSM Overpass tags every golf feature as a polygon (fairway, green,
// tee box, bunker, water hazard, rough). The geometry endpoint now
// pulls full polygons (not just centroids) and associates each with
// its nearest hole's tee→green line. Client renders them as SVG fills
// on top of the satellite tile, mirroring Bluegolf / Golfshot's
// stylized hole view from free open data.
export type Polygon = ShotLocation[];

export type LandmarkFeature = {
  /** OSM polygon ring. Empty array means we only have a centroid. */
  polygon: Polygon;
  /** Centroid for fast distance / labeling. */
  centroid: ShotLocation;
  /** Auto-derived side relative to the tee→green line: left, right,
   *  or greenside (within ~30y of the green). null when no tee/green
   *  reference is available. */
  side: 'left' | 'right' | 'greenside' | 'fairway' | null;
  /** Optional OSM `name` tag — e.g. "Big Bunker", "Pond". */
  name: string | null;
};

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
  // 2026-05-17 — Polygon overlays for Bluegolf-style rendering.
  // All optional — fall through to existing point-only rendering when
  // upstream doesn't supply polygons.
  green_polygon?: Polygon | null;
  tee_polygon?: Polygon | null;
  fairway_polygons?: Polygon[];
  bunkers?: LandmarkFeature[];
  water_hazards?: LandmarkFeature[];
  // 2026-07-14 (Tim — "cheat the paid geometry DB") — set true when this hole's coords were
  // DERIVED by AI vision from satellite imagery (services/holeGeometryDerivation), not from a
  // curated/API source. Consumers badge it as ESTIMATED and use it ONLY as a fallback. Absent
  // on all real geometry, so existing reads are unchanged.
  estimated?: boolean;
  estimated_confidence?: 'high' | 'medium' | 'low';
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
// 2026-07-23 (Tim — "the new courses show no geometry / green screen") — bundled-course geometry.
// Courses authored in data/courses.ts (Highland Links, Miccosukee, Killian, Redlands) have full
// screenshot-anchored per-hole tee/green coords but NO golfcourseapi id or LOCAL_COURSE_CENTROIDS
// entry, so fetchCourseGeometry's API/OSM path returns null → every consumer read "no geometry" and
// no satellite tile rendered. Their bundled coords ARE curated ground truth, so hydrate geometry
// straight from them. This is a SYNC fallback for the cache readers (renders instantly, offline),
// and the async fetch prefers it too. Real API geometry, once loaded into memCache, still wins.
const bundledGeomCache = new Map<string, CourseGeometry | null>();
function isGeoCoord(lat?: number, lng?: number): lat is number {
  return typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng)
    && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(Math.abs(lat) < 0.001 && Math.abs(lng) < 0.001);
}
function buildBundledGeometry(courseId: string): CourseGeometry | null {
  if (!courseId) return null;
  if (bundledGeomCache.has(courseId)) return bundledGeomCache.get(courseId) ?? null;
  let result: CourseGeometry | null = null;
  try {
    // Dynamic require avoids any import cycle with data/courses (same pattern as roundStore below).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getBundledHoles } = require('../data/courses') as typeof import('../data/courses');
    const holes = getBundledHoles(courseId);
    const geoHoles: HoleGeometry[] = holes
      .filter(h => isGeoCoord(h.teeLat, h.teeLng) || isGeoCoord(h.middleLat, h.middleLng))
      .map(h => ({
        hole_number: h.hole,
        par: h.par,
        yardage: h.distance,
        tee: isGeoCoord(h.teeLat, h.teeLng) ? { lat: h.teeLat, lng: h.teeLng } : null,
        green: isGeoCoord(h.middleLat, h.middleLng) ? { lat: h.middleLat, lng: h.middleLng } : null,
        green_front: isGeoCoord(h.frontLat, h.frontLng) ? { lat: h.frontLat, lng: h.frontLng } : null,
        green_back: isGeoCoord(h.backLat, h.backLng) ? { lat: h.backLat, lng: h.backLng } : null,
        bearing_deg: null,
        hazards: [],
        fairway_centerline: [],
        green_outline: [],
      }));
    if (geoHoles.length > 0) {
      result = { course_id: courseId, course_name: courseId, fetched_at: Date.now(), holes: geoHoles };
    }
  } catch (e) {
    console.warn('[courseGeometry] bundled hydrate failed for', courseId, e);
  }
  bundledGeomCache.set(courseId, result);
  return result;
}

export function getCachedGeometry(courseId: string): CourseGeometry | null {
  return memCache.get(courseId) ?? buildBundledGeometry(courseId);
}

/** Returns a single hole's geometry from cache (or bundled coords), or null if none exists. */
export function getHoleGeometry(courseId: string, holeNumber: number): HoleGeometry | null {
  const c = memCache.get(courseId) ?? buildBundledGeometry(courseId);
  return c?.holes.find(h => h.hole_number === holeNumber) ?? null;
}

// ─── Derived (AI-estimated) geometry — kept SEPARATE from the real cache ──────
// 2026-07-14 (Tim — "cheat the paid geometry DB. Pull up ANY course → AI assembles geometry").
// Estimated per-hole geometry lives in its own keyed cache so it can NEVER be returned by
// getHoleGeometry()/getCachedGeometry() to consumers that assume curated/API truth. SmartVision
// (and the CNS) opt IN explicitly via getDerivedHoleGeometry() and always badge it ESTIMATED.
// Offline: persisted to AsyncStorage; hydrated lazily into memory on first read.
const DERIVED_KEY_PREFIX = 'course-geometry-derived-v1::';
const derivedMemCache: Map<string, Record<number, HoleGeometry>> = new Map();

function derivedKey(courseId: string): string {
  return DERIVED_KEY_PREFIX + courseId;
}

/** Synchronous read of a single AI-derived hole (null until loadDerivedGeometry has hydrated). */
export function getDerivedHoleGeometry(courseId: string, holeNumber: number): HoleGeometry | null {
  if (!courseId) return null;
  return derivedMemCache.get(courseId)?.[holeNumber] ?? null;
}

/** Hydrate the derived cache for a course from disk (offline-first). Best-effort. */
export async function loadDerivedGeometry(courseId: string): Promise<Record<number, HoleGeometry>> {
  if (!courseId) return {};
  const mem = derivedMemCache.get(courseId);
  if (mem) return mem;
  try {
    const raw = await AsyncStorage.getItem(derivedKey(courseId));
    const parsed = raw ? (JSON.parse(raw) as Record<number, HoleGeometry>) : {};
    derivedMemCache.set(courseId, parsed);
    return parsed;
  } catch {
    return {};
  }
}

/**
 * Anchor an AI-derived hole into the derived cache (mem + disk). Additive: overwrites only the
 * one hole, never touches real geometry. Marks estimated=true defensively. Returns the hole.
 */
export async function saveDerivedHoleGeometry(
  courseId: string,
  hole: HoleGeometry,
): Promise<HoleGeometry | null> {
  if (!courseId || typeof hole.hole_number !== 'number') return null;
  const existing = await loadDerivedGeometry(courseId);
  const marked: HoleGeometry = { ...hole, estimated: true };
  const next = { ...existing, [hole.hole_number]: marked };
  derivedMemCache.set(courseId, next);
  try {
    await AsyncStorage.setItem(derivedKey(courseId), JSON.stringify(next));
  } catch (e) {
    console.warn('[courseGeometry] derived cache write failed:', e);
  }
  return marked;
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
 *
 * 2026-05-16 — For "local:<slug>" courseIds (Sunnyvale, San Jose Muni)
 * we lazily resolve the upstream golfcourseapi ID via searchCourses,
 * then fetch geometry by that real ID. Cache stays keyed by the local
 * courseId so the rest of the app (which uses "local:sunnyvale" as
 * the active courseId) gets the cached hit on subsequent lookups.
 */

// 2026-06-03 — Derive a course centroid from the active round's
// courseHoles tee coords. Used for non-local: courseIds so the server-
// side OSM fallback has a bounding-box anchor to query Overpass against.
// Dynamic require avoids the circular import (roundStore lazy-requires
// this service for greenForHole). Returns null when no active round
// or no valid tee coords — caller treats null as "no centroid" and
// the existing pre-fix behavior holds.
function deriveCentroidFromActiveCourseHoles(): { lat: number; lng: number } | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useRoundStore } = require('../store/roundStore') as typeof import('../store/roundStore');
    const holes = useRoundStore.getState().courseHoles ?? [];
    let latSum = 0;
    let lngSum = 0;
    let count = 0;
    for (const h of holes) {
      if (
        typeof h.teeLat === 'number' && typeof h.teeLng === 'number' &&
        Number.isFinite(h.teeLat) && Number.isFinite(h.teeLng) &&
        Math.abs(h.teeLat) > 0.001 && Math.abs(h.teeLng) > 0.001 &&
        Math.abs(h.teeLat) <= 90 && Math.abs(h.teeLng) <= 180
      ) {
        latSum += h.teeLat;
        lngSum += h.teeLng;
        count += 1;
      }
    }
    if (count === 0) return null;
    return { lat: latSum / count, lng: lngSum / count };
  } catch {
    return null;
  }
}

function deriveCentroidFromActiveCourseLocation(
  courseId: string,
): { lat: number; lng: number } | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useRoundStore } = require('../store/roundStore') as typeof import('../store/roundStore');
    const round = useRoundStore.getState();
    if (round.activeCourseId !== courseId) return null;
    const loc = round.courseLocation;
    if (!loc) return null;
    if (!Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) return null;
    if (Math.abs(loc.lat) > 90 || Math.abs(loc.lng) > 180) return null;
    if (Math.abs(loc.lat) < 0.001 && Math.abs(loc.lng) < 0.001) return null;
    return { lat: loc.lat, lng: loc.lng };
  } catch {
    return null;
  }
}

export async function fetchCourseGeometry(
  courseId: string,
  options?: { courseLocation?: { lat: number; lng: number } | null },
): Promise<CourseGeometry | null> {
  if (!courseId) return null;

  const memHit = memCache.get(courseId);
  if (memHit && Date.now() - memHit.fetched_at < REFRESH_AFTER_MS) return memHit;

  const persisted = await readPersistedCache(courseId);
  if (persisted) {
    memCache.set(courseId, persisted);
    if (Date.now() - persisted.fetched_at < REFRESH_AFTER_MS) return persisted;
    // 2026-05-26 — Fix DI: stale-while-revalidate. When a persisted
    // entry exists but is older than REFRESH_AFTER_MS (1 week), return
    // it IMMEDIATELY so the UI renders instantly with cached geometry,
    // then fire the upstream re-fetch in the background to refresh the
    // cache for the NEXT visit. Prior behavior blocked on the fresh
    // fetch even when a stale entry was available, causing 2-5s splash
    // on weekly cached courses. The promise below is intentionally
    // detached (void) — we don't await it; persisted is returned now.
    void refreshGeometryInBackground(courseId).catch(() => undefined);
    return persisted;
  }

  // Resolve "local:<slug>" → real upstream golfcourseapi ID, if we have
  // a hint for this slug. Result is cached so subsequent rounds skip
  // the search round-trip.
  // 2026-05-17 — Also resolves the course centroid so we can hand it to
  // the server-side OSM Overpass fallback. golfcourseapi's free tier
  // returns null per-hole coords for municipal courses like Sunnyvale;
  // OSM has the green polygons we need to fill those in automatically.
  let upstreamId = courseId;
  let centroid: { lat: number; lng: number } | null = null;
  let holeCount: number | null = null;
  if (courseId.startsWith('local:')) {
    const slug = courseId.slice('local:'.length);
    centroid = LOCAL_COURSE_CENTROIDS[slug as LocalCourseSlug] ?? null;
    holeCount = LOCAL_COURSE_HOLE_COUNT[slug] ?? null;
    const real = await resolveLocalCourseId(slug);
    if (real) {
      upstreamId = real;
    } else if (!centroid) {
      // No upstream and no centroid — but a bundled course carries its own coords. Use them.
      const bundled = buildBundledGeometry(courseId);
      if (bundled) { memCache.set(courseId, bundled); void writePersistedCache(bundled).catch(() => undefined); return bundled; }
      return persisted ?? buildBundledGeometry(courseId) ?? null;
    } else {
      // No upstream mapping but we know where the course is. Fall
      // through to an OSM-only request below (the server endpoint
      // synthesizes holes from OSM greens/tees when osmOnly=1).
      upstreamId = '__osm_only__';
    }
  } else if (!centroid) {
    // 2026-06-03 — Non-local: courseIds (golfcourseapi-only, e.g. Green
    // Hill and every other course Tim hasn't bundled). Derive a centroid
    // from the active round's courseHoles tee coords so the server-side
    // OSM null-green fallback + polygon enrichment have a bounding box
    // to query Overpass against. golfcourseapi free tier returns tee
    // coords per hole but null greens; the OSM fallback fills the
    // greens automatically — but only when we send a centroid.
    centroid = deriveCentroidFromActiveCourseHoles();
    if (!centroid) {
      const provided = options?.courseLocation;
      if (
        provided &&
        Number.isFinite(provided.lat) &&
        Number.isFinite(provided.lng) &&
        Math.abs(provided.lat) <= 90 &&
        Math.abs(provided.lng) <= 180 &&
        !(Math.abs(provided.lat) < 0.001 && Math.abs(provided.lng) < 0.001)
      ) {
        centroid = { lat: provided.lat, lng: provided.lng };
      }
    }
    if (!centroid) {
      centroid = deriveCentroidFromActiveCourseLocation(courseId);
    }
  }

  const apiUrl = getApiBaseUrl();
  const params = new URLSearchParams({ courseId: upstreamId });
  if (centroid) {
    params.set('lat', String(centroid.lat));
    params.set('lng', String(centroid.lng));
  }
  if (holeCount != null) {
    params.set('holeCount', String(holeCount));
  }
  if (upstreamId === '__osm_only__') {
    params.set('osmOnly', '1');
  }
  // 2026-05-17 — Polygon enrichment requires a centroid (server-side
  // gate at api/course-geometry.ts checks `withPolygons && centroid`).
  // local: courses always have a centroid from LOCAL_COURSE_CENTROIDS;
  // non-local: courses get one derived from tee coords above. Either
  // way, send withPolygons whenever we have a centroid so SmartVision
  // gets full hole geometry on every course, not just bundled ones.
  if (centroid) {
    params.set('withPolygons', '1');
  }
  const url = `${apiUrl}/api/course-geometry?${params.toString()}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) {
      console.warn('[courseGeometry] fetch failed:', res.status);
      return persisted ?? buildBundledGeometry(courseId) ?? null;
    }
    const geo = (await res.json()) as CourseGeometry;
    geo.fetched_at = Date.now();
    // Force-key the result by the LOCAL courseId so getHoleGeometry()
    // and downstream consumers can read by the same id the rest of the
    // app uses. Without this, the cache stores under the upstream id
    // and SmartVision's getHoleGeometry(courseId='local:sunnyvale')
    // would miss the cache forever.
    geo.course_id = courseId;
    memCache.set(courseId, geo);
    await writePersistedCache(geo);
    return geo;
  } catch (e) {
    console.warn('[courseGeometry] fetch exception:', e);
    return persisted ?? buildBundledGeometry(courseId) ?? null;
  }
}

/**
 * 2026-05-26 — Fix DI: background refresh helper for stale-while-revalidate.
 * Called from fetchCourseGeometry when a persisted entry is stale (>1 week
 * old). Fires a fresh fetch and writes back to the cache, but doesn't block
 * the caller. The fresh result lands silently for the NEXT visit.
 *
 * Mirrors the inline fetch in fetchCourseGeometry but skips the cache
 * check (which the caller already did). On failure, the stale cache stays
 * — no eviction. Never throws; logs and returns.
 */
async function refreshGeometryInBackground(courseId: string): Promise<void> {
  try {
    let upstreamId = courseId;
    let centroid: { lat: number; lng: number } | null = null;
    let holeCount: number | null = null;
    if (courseId.startsWith('local:')) {
      const slug = courseId.slice('local:'.length);
      centroid = LOCAL_COURSE_CENTROIDS[slug as LocalCourseSlug] ?? null;
      holeCount = LOCAL_COURSE_HOLE_COUNT[slug] ?? null;
      const real = await resolveLocalCourseId(slug);
      if (real) upstreamId = real;
      else if (!centroid) return;
      else upstreamId = '__osm_only__';
    } else if (!centroid) {
      // 2026-06-03 — Mirror of fetchCourseGeometry's non-local: centroid
      // derivation. Stale-cache background refresh hits this for any
      // golfcourseapi-only course; if we don't supply a centroid the
      // refresh writes back a no-polygon entry, regressing SmartVision.
      centroid = deriveCentroidFromActiveCourseHoles();
      if (!centroid) {
        centroid = deriveCentroidFromActiveCourseLocation(courseId);
      }
    }
    const apiUrl = getApiBaseUrl();
    const params = new URLSearchParams({ courseId: upstreamId });
    if (centroid) {
      params.set('lat', String(centroid.lat));
      params.set('lng', String(centroid.lng));
    }
    if (holeCount != null) params.set('holeCount', String(holeCount));
    if (upstreamId === '__osm_only__') params.set('osmOnly', '1');
    if (centroid) params.set('withPolygons', '1');
    const url = `${apiUrl}/api/course-geometry?${params.toString()}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) {
      console.warn('[courseGeometry] background refresh failed:', res.status, courseId);
      return;
    }
    const geo = (await res.json()) as CourseGeometry;
    geo.fetched_at = Date.now();
    geo.course_id = courseId;
    memCache.set(courseId, geo);
    await writePersistedCache(geo);
    console.log('[courseGeometry] background refresh ok:', courseId);
  } catch (e) {
    console.warn('[courseGeometry] background refresh exception:', e instanceof Error ? e.message : String(e), courseId);
  }
}

/** Test/debug only. */
export function _clearGeometryCache(): void {
  memCache.clear();
}

/** 2026-05-18 — Test/debug only. Seed a synthetic CourseGeometry into
 *  the in-memory cache so holeDetection.detectCurrentHole() finds tee +
 *  green coords for hole-transition logic. Used by the synthetic round
 *  harness (services/simulatedGPS.ts → startSyntheticRound) so the
 *  simulator can drive automatic hole advancement end-to-end without
 *  needing a real Overpass fetch. */
export function _seedGeometry(geometry: CourseGeometry): void {
  memCache.set(geometry.course_id, geometry);
}
