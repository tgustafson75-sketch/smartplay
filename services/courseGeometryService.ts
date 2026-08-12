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
  'mines-gc': 18,
  'dale-hollow': 18,
  'old-fort': 18,
  'nashboro': 18,
  'hermitage-pr': 18,
  'legacy-springfield': 18,
  'gleneagles-kings': 18,
  'gleneagles-queens': 18,
  'querencia': 18,
  'palms': 18,
  'lakes': 18,
  'rancho-california': 18,
  'crystal-springs': 18,
  'mariners-point': 9,
  'san-jose-muni': 18,
  'sunnyvale': 18,
  // 2026-05-28 — Westlake Country Club, Jackson NJ.
  'westlake-cc-nj': 18,
  // 2026-07-28 (audit — DISCO-F4) — new bundled courses. Harmless today (no API hint → bundled path
  // wins), but closes the latent trap where an added hint would pad Pruneridge's 9 holes to 18.
  'coyote-creek-tournament': 18,
  'coyote-creek-valley': 18,
  'pruneridge': 9,
  'wente-vineyards': 18,
  'yocha-dehe': 18,
  'shadow-lakes': 18,
  'crane-creek': 18,
  'manatee-cove': 18,
  // 2026-08-10 (course-builder audit — Finding #2) — the three 9-hole bundled courses (Berlin CC is
  // 9-par-33; Webster/Dudley is the nine played twice for 18; Echo Hills has 9 mapped holes). Same
  // defensive intent as the DISCO-F4 block above: bundled coords win today so the cap is inert, but
  // registering the TRUE physical count means a later API hint can never pad the nine to eighteen
  // ghost holes (which would also silently disable the client's twice-around wrap).
  'berlin-cc': 9,
  'webster-dudley': 9,
  'echo-hills': 9,
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

// 2026-07-28 (audit — DISCO-F1, CONFIRMED ×2) — bumped v1→v2 so testers who persisted the OLD
// scrambled bundled coords (from a pre-07-28 build) MISS on this key once and re-hydrate the CORRECTED
// data/courses.ts geometry. The prefix carries no data-version otherwise, and nothing else invalidates
// it on OTA — so without this bump the whole OSM-hole-ways framing fix stays shadowed by the old cache
// on the 6 no-hint courses (Highland, Mines, Redlands, Killian, Hermitage, Miccosukee). Bump again on
// any future bundled-coord change.
// 2026-08-10 (Tim — "there's no more green screen on Connecticut National, but the ORIENTATION of the
// holes is still completely wrong" … then "when I restarted the app, it went back to a green screen").
//
// Both symptoms are ONE root cause, and it is the reason today's server fixes never reached his phone.
// The server data is now verifiably correct — the stored Connecticut National build validates 18/18
// against the scorecard, mean error 6%. But this cache returns a persisted copy IMMEDIATELY whenever
// it is younger than REFRESH_AFTER_MS, and that window is a WEEK. So the geometry his device captured
// during the broken round — parking-lot tees, and at one point zero greens — was pinned locally for
// seven days, served on every launch, and no amount of fixing the server could dislodge it.
//
// v2→v3 orphans every entry written today, on every device, at once. That is the immediate unblock.
const CACHE_KEY_PREFIX = 'course-geometry-v3::';
/**
 * The structural fix, so the next geometry correction doesn't need a key bump to reach anyone:
 * every cached entry records the pipeline version that produced it. A cached entry from an older
 * pipeline is treated as STALE regardless of age — refetched rather than served. Bump this whenever
 * the geometry pipeline's OUTPUT changes (pairing rules, validation, new fields), which is exactly
 * the class of change that was silently unable to reach existing users.
 */
const GEOMETRY_PIPELINE_VERSION = 3;
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
/**
 * Yards between two coordinates. Used to ask whether bundled geometry can reproduce its own
 * scorecard — the same question the on-course measuring tool asks.
 */
function haversineYards(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const x =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x)) * 1.09361;
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
  const direct = c?.holes.find(h => h.hole_number === holeNumber);
  if (direct) return direct;
  // 2026-08-08 (Tim — "allow a 9-hole course to be played twice"). TWICE-AROUND wrap: at a course whose
  // geometry has exactly 9 holes, holes 10-18 are the SAME physical holes 1-9 played again — serve the
  // wrapped geometry so GPS yardage / hole detection / green centroids / tee briefs all work on the
  // second loop. Only fires when the course genuinely has 9 (an 18-hole course never wraps), and being
  // on hole 12 of a 9-hole course is only possible in a twice-around round.
  if (holeNumber >= 10 && holeNumber <= 18 && c && c.holes.length === 9) {
    // 2026-08-08 (verification wave, replacing the wave-2 count guess) — gate the wrap on the round's
    // AUTHORITATIVE twiceAround flag, stamped by runStartRound (the one place that knows the 18 holes
    // are a 9-hole course doubled). The old getCourseHoleCount guard was CIRCULAR for non-bundled ids
    // (it fed the geometry's own length back in as the fallback), so an 18-hole API course whose
    // OSM/server geometry resolved exactly 9 holes wrapped front-nine tees/greens onto the real back
    // nine — wrong yardages presented as real. Outside an active twice-around round there is no honest
    // reason to serve hole 12 of a 9-hole set.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { useRoundStore } = require('../store/roundStore') as typeof import('../store/roundStore');
      const rs = useRoundStore.getState();
      if (!(rs.isRoundActive && rs.twiceAround && rs.activeCourseId === courseId)) return null;
    } catch { return null; /* store unavailable — never wrap on a guess */ }
    const wrapped = c.holes.find(h => h.hole_number === holeNumber - 9);
    if (wrapped) return { ...wrapped, hole_number: holeNumber };
  }
  return null;
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

/**
 * 2026-08-10 — is this cached entry still allowed to be served WITHOUT a refetch?
 *
 * Age alone was the only test, and a week is far too long a leash for data that can be wrong. Two
 * additional disqualifiers, both drawn from what actually happened on Tim's phone:
 *   - produced by an OLDER pipeline → the rules that built it have since been corrected;
 *   - ZERO mapped holes → an empty course can never be the right answer to serve, at any age. That
 *     is the entry that made the green screen come back on every restart.
 */
function cacheIsServable(geo: CourseGeometry | null): boolean {
  if (!geo) return false;
  const v = (geo as CourseGeometry & { pipeline_version?: number }).pipeline_version ?? 0;
  if (v !== GEOMETRY_PIPELINE_VERSION) return false;
  if (mappedHoleCount(geo) === 0) return false;
  return Date.now() - geo.fetched_at < REFRESH_AFTER_MS;
}

/** How many holes in this geometry actually carry a usable green — the measure of "is this real". */
export function mappedHoleCount(geo: CourseGeometry | null | undefined): number {
  if (!geo?.holes?.length) return 0;
  return geo.holes.filter(h => h.green != null).length;
}

/**
 * 2026-08-10 (Tim, after the round — "most of it didn't load correctly, and if the course doesn't
 * load correctly the whole app doesn't work").
 *
 * A course that loaded FINE five minutes ago must not be erased by one bad fetch. The upstream
 * geometry depends on free community Overpass mirrors; even with three of them and a retry, a
 * measured 1-in-6 of production calls still comes back with zero greens. That response used to be
 * written straight over a perfectly good cached course — so a single unlucky refresh turned a
 * working course into an empty one, and it STAYED empty because the empty version was now the cache.
 *
 * So the cache never accepts a downgrade: a write with fewer mapped holes than what's already stored
 * is dropped. Real improvements (more holes mapped, refreshed detail) still land normally, and a
 * course we have nothing for is still written the first time.
 */
async function writePersistedCache(geo: CourseGeometry): Promise<void> {
  try {
    // Stamp the pipeline that produced this entry so a future correction can invalidate it.
    (geo as CourseGeometry & { pipeline_version?: number }).pipeline_version = GEOMETRY_PIPELINE_VERSION;
    const incoming = mappedHoleCount(geo);
    if (incoming === 0) {
      const existing = await readPersistedCache(geo.course_id);
      if (mappedHoleCount(existing) > 0) {
        console.warn(`[courseGeometry] refusing to overwrite ${mappedHoleCount(existing)} mapped holes with an EMPTY read for ${geo.course_id} — keeping the good cache`);
        return;
      }
    } else {
      const existing = await readPersistedCache(geo.course_id);
      const had = mappedHoleCount(existing);
      if (had > incoming) {
        console.warn(`[courseGeometry] refusing to downgrade ${geo.course_id}: cached ${had} mapped holes, incoming only ${incoming}`);
        return;
      }
    }
    await AsyncStorage.setItem(cacheKey(geo.course_id), JSON.stringify(geo));
  } catch (e) {
    console.warn('[courseGeometry] cache write failed:', e);
  }
}


/**
 * Commit a freshly-fetched geometry to BOTH caches, refusing a downgrade in either.
 * The in-memory cache needs the same guard as disk: without it an empty read still wins for the
 * rest of the session, so the course stays broken until the app restarts even though the good
 * copy is safe on disk.
 */
async function commitGeometry(courseId: string, geo: CourseGeometry): Promise<CourseGeometry> {
  const incoming = mappedHoleCount(geo);
  const inMem = memCache.get(courseId);
  if (mappedHoleCount(inMem) > incoming) {
    console.warn(`[courseGeometry] keeping the better in-memory copy of ${courseId} (${mappedHoleCount(inMem)} vs ${incoming} mapped holes)`);
    await writePersistedCache(geo); // still guarded on disk; a no-op when it would downgrade
    return inMem as CourseGeometry;
  }
  memCache.set(courseId, geo);
  await writePersistedCache(geo);
  return geo;
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

/**
 * 2026-08-10 (Tim — "need something in the app to prevent racing and prevent cache buildup that can
 * clean up and refresh back to no bad content as needed").
 *
 * THREE jobs, all of which this module was missing:
 *
 * 1. ANTI-RACE. fetchCourseGeometry had no in-flight guard, so a screen mounting three surfaces at
 *    once (caddie preview + SmartVision + prefetch) fired three identical builds. Each hammered the
 *    same Overpass mirrors — making throttling MORE likely, the very failure that started all of
 *    this — and then all three raced to write the cache, so whichever finished last won regardless
 *    of quality. One promise per course now serves every concurrent caller.
 *
 * 2. NO BUILDUP. Entries accumulated forever, one per course ever opened, with nothing to evict
 *    them. sweepGeometryCache() drops keys from superseded pipelines and any entry with zero mapped
 *    holes, then trims the oldest beyond a cap.
 *
 * 3. RECOVERY. purgeCourseGeometry() gives a real "clean up and refresh" — clear the bad content and
 *    let the next read rebuild from the server, without a reinstall.
 */
const inflight: Map<string, Promise<CourseGeometry | null>> = new Map();

/** Max persisted course entries to keep. A heavy user plays a handful of courses; this is generous. */
const MAX_CACHED_COURSES = 40;

/**
 * Drop unusable entries and trim the cache. Safe to call at launch — it never touches an entry that
 * is servable, so a good offline course survives. Returns how many keys were removed.
 */
export async function sweepGeometryCache(): Promise<number> {
  let removed = 0;
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter(k => k.startsWith(CACHE_KEY_PREFIX));
    // Entries from a SUPERSEDED key prefix (v1/v2) are pure dead weight — nothing can ever read them.
    const deadPrefixes = ['course-geometry-v1::', 'course-geometry-v2::'];
    const orphans = (await AsyncStorage.getAllKeys()).filter(k => deadPrefixes.some(p => k.startsWith(p)));
    if (orphans.length) {
      await AsyncStorage.multiRemove(orphans).catch(() => undefined);
      removed += orphans.length;
    }

    const entries: { key: string; fetched_at: number; usable: boolean }[] = [];
    for (const k of keys) {
      try {
        const raw = await AsyncStorage.getItem(k);
        if (!raw) continue;
        const geo = JSON.parse(raw) as CourseGeometry & { pipeline_version?: number };
        const usable = (geo.pipeline_version ?? 0) === GEOMETRY_PIPELINE_VERSION && mappedHoleCount(geo) > 0;
        entries.push({ key: k, fetched_at: geo.fetched_at ?? 0, usable });
      } catch {
        // Unparseable entry — remove it; it can only ever throw again.
        await AsyncStorage.removeItem(k).catch(() => undefined);
        removed++;
      }
    }

    const junk = entries.filter(e => !e.usable);
    if (junk.length) {
      await AsyncStorage.multiRemove(junk.map(e => e.key)).catch(() => undefined);
      removed += junk.length;
    }

    // Trim the oldest usable entries beyond the cap — they refetch on demand.
    const usable = entries.filter(e => e.usable).sort((a, b) => b.fetched_at - a.fetched_at);
    if (usable.length > MAX_CACHED_COURSES) {
      const excess = usable.slice(MAX_CACHED_COURSES).map(e => e.key);
      await AsyncStorage.multiRemove(excess).catch(() => undefined);
      removed += excess.length;
    }
    if (removed > 0) console.log(`[courseGeometry] cache sweep removed ${removed} entr${removed === 1 ? 'y' : 'ies'}`);
  } catch (e) {
    console.warn('[courseGeometry] cache sweep failed (non-fatal):', e instanceof Error ? e.message : e);
  }
  return removed;
}

/**
 * Hard reset for one course (or all of them). The "refresh back to no bad content" escape hatch:
 * the next read rebuilds from the server. Never throws.
 */
export async function purgeCourseGeometry(courseId?: string): Promise<void> {
  try {
    if (courseId) {
      memCache.delete(courseId);
      inflight.delete(courseId);
      await AsyncStorage.removeItem(cacheKey(courseId)).catch(() => undefined);
      console.log('[courseGeometry] purged', courseId);
      return;
    }
    memCache.clear();
    inflight.clear();
    const keys = (await AsyncStorage.getAllKeys()).filter(k => k.startsWith(CACHE_KEY_PREFIX));
    if (keys.length) await AsyncStorage.multiRemove(keys).catch(() => undefined);
    console.log('[courseGeometry] purged ALL course geometry —', keys.length, 'entries');
  } catch (e) {
    console.warn('[courseGeometry] purge failed:', e instanceof Error ? e.message : e);
  }
}

export async function fetchCourseGeometry(
  courseId: string,
  options?: { courseLocation?: { lat: number; lng: number } | null },
): Promise<CourseGeometry | null> {
  if (!courseId) return null;
  /**
   * 2026-08-10 — ANTI-RACE. Several surfaces ask for the same course at the same moment (the caddie
   * preview, SmartVision, the round prefetch). Without this each fired its OWN build: three sets of
   * Overpass calls, which makes the throttling that broke the engine MORE likely, and then three
   * writers racing the cache so the last one to finish won regardless of quality. One promise per
   * course now serves every concurrent caller; it clears on settle so later calls refetch normally.
   */
  const pending = inflight.get(courseId);
  if (pending) return pending;
  const run = fetchCourseGeometryInner(courseId, options).finally(() => { inflight.delete(courseId); });
  inflight.set(courseId, run);
  return run;
}

async function fetchCourseGeometryInner(
  courseId: string,
  options?: { courseLocation?: { lat: number; lng: number } | null },
): Promise<CourseGeometry | null> {

  const memHit = memCache.get(courseId);
  // 2026-08-10 — servability, not just age: an entry from an older pipeline or one with zero
  // mapped holes is never served, however recent it is.
  if (memHit && cacheIsServable(memHit)) return memHit;

  const persisted = await readPersistedCache(courseId);
  if (persisted) {
    memCache.set(courseId, persisted);
    if (cacheIsServable(persisted)) return persisted;
    /**
     * 2026-08-10 — POISONED entries must not be served even once more.
     *
     * Stale-while-revalidate is right for data that is merely OLD: show it now, refresh behind. It
     * is exactly wrong for data we have positive reason to distrust — an entry from a superseded
     * pipeline, or one with zero mapped holes. Returning those "just for this launch" is precisely
     * what put a green screen back on Tim's screen every restart while the correct data sat one
     * fetch away. So: old → serve and refresh; suspect → drop it and go get the real thing.
     */
    const suspect =
      ((persisted as CourseGeometry & { pipeline_version?: number }).pipeline_version ?? 0) !== GEOMETRY_PIPELINE_VERSION ||
      mappedHoleCount(persisted) === 0;
    if (suspect) {
      console.log(`[courseGeometry] discarding suspect cache for ${courseId} (pipeline/empty) — fetching fresh`);
      memCache.delete(courseId);
      await AsyncStorage.removeItem(cacheKey(courseId)).catch(() => undefined);
    } else {
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
  /** 2026-08-11 — bundled geometry we chose NOT to trust; still better than nothing if the build fails. */
  let bundledFallback: CourseGeometry | null = null;
  if (courseId.startsWith('local:')) {
    const slug = courseId.slice('local:'.length);
    centroid = LOCAL_COURSE_CENTROIDS[slug as LocalCourseSlug] ?? null;
    holeCount = LOCAL_COURSE_HOLE_COUNT[slug] ?? null;
    const real = await resolveLocalCourseId(slug);
    if (real) {
      upstreamId = real;
    } else {
      // No upstream API mapping. Our OWN screenshot-anchored bundled coords are ground truth and
      // MUST win over OSM synthesis — OSM has no hole numbers, so it scrambles the routing (attaches
      // greens to the wrong hole, ghost-holes a 9-green course into 18). Prefer bundled here, both
      // online and offline. Only when we have NO bundled coords do we fall to the OSM-only request.
      /**
       * 2026-08-11 (Tim — "if the bundled courses are causing the issue, then they need to be
       * replaced with the new engine courses, but they need to be BUILT because testers are on them").
       *
       * The comment above — bundled is ground truth, OSM scrambles routing — was TRUE when OSM
       * synthesis had no hole numbers. It isn't any more: the engine's `osm_holeways` pass reads
       * real `ref` hole numbers and pars off OSM golf=hole ways. Measured on Greenhill just now:
       *
       *   bundled coords  14 of 16 holes contradict their own scorecard (~0.4x the card)
       *   engine build    17 of 18 holes within 35%, most within 10%
       *
       * So "bundled always wins" was actively serving the worse data on exactly the courses testers
       * are playing. Bundled still wins when it's GOOD — that's most courses, and their
       * screenshot-anchored coords are excellent. It only loses when it has failed its own
       * scorecard: if fewer than half the holes still carry a tee after validateBundledTees stripped
       * the self-contradicting ones, the bundle is not ground truth for this course and the engine
       * gets a turn. Bundled remains the fallback if the engine can't build.
       */
      const bundled = buildBundledGeometry(courseId);
      /**
       * 2026-08-11 (QA pass) — this used to count PRESENCE of coordinates, which is not the same
       * question as whether they're right, and the difference was hiding real breakage.
       *
       * Tim: "the measuring tool does not often land correctly on the teebox and green." Measuring
       * every bundled hole's tee→green distance against its own scorecard yardage found three
       * courses badly out — greenhill 51% mean error, westlake 61%, echo-hills 40%, with holes like
       * Greenhill 1 measuring 150y against a 374y card. Their GREENS are good (the derived centroid
       * matched OSM to 31m); the stored TEES are not, and re-pairing them doesn't rescue it.
       *
       * All three sailed through the old check, because 16 of 18 holes did have both coordinates.
       * So the app kept serving coordinates that fail their own scorecard, on the exact courses
       * where the engine builds perfectly — Greenhill from its corrected centroid returns 18 holes
       * with 18 greens and 18 tees.
       *
       * A scorecard yardage IS the measuring tool's expected answer, so it's the honest test:
       * bundled geometry is ground truth only when it can reproduce the card.
       */
      const bundledIsTrustworthy = (() => {
        if (!bundled?.holes?.length) return false;
        const withTee = bundled.holes.filter(h => h.tee && h.green).length;
        if (withTee < Math.ceil(bundled.holes.length * 0.5)) return false;

        // Does the geometry reproduce the card? Compare only holes carrying a real card yardage.
        const measurable = bundled.holes.filter(h => h.tee && h.green && (h.yardage ?? 0) > 50);
        if (measurable.length < 3) return true; // too little to judge — don't demote on no evidence
        const errs = measurable.map(h => {
          const measured = haversineYards(h.tee!, h.green!);
          return Math.abs(measured - h.yardage!) / h.yardage!;
        });
        const mean = errs.reduce((a, b) => a + b, 0) / errs.length;
        // 25% mean is deliberately generous: honest tee-marker variance and green-centre choice run
        // well under 10% (the good courses here measure 0.1-3%). 25% only catches genuine breakage.
        return mean <= 0.25;
      })();
      if (bundled && bundledIsTrustworthy) {
        memCache.set(courseId, bundled);
        void writePersistedCache(bundled).catch(() => undefined);
        return bundled;
      }
      if (!centroid) return bundled ?? persisted ?? null;
      if (bundled) {
        console.log(`[courseGeometry] bundled coords for ${courseId} failed their own scorecard — building from the engine instead`);
      }
      // Either no bundled coords, or bundled coords we can't trust: build from OSM (osmOnly=1).
      // 2026-08-11 — keep the bundled copy as the fallback so a failed build never leaves a course
      // with LESS than it had before; testers are mid-beta on these.
      bundledFallback = bundled ?? null;
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
    // 2026-08-10 (Tim — "the course builder like Arccos HAS to work"). Finding #1: the player is
    // STANDING on an unbundled course with a live GPS fix, but we were throwing it away — so a course
    // whose API record lacks coords got frozen scorecard yardages, no live distance-to-green. Use the
    // live fix as the centroid so the server OSM green-fill fires and greens map at ANY course.
    if (!centroid) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const fix = (require('./gpsManager') as typeof import('./gpsManager')).getLastFix();
        if (fix && Number.isFinite(fix.lat) && Number.isFinite(fix.lng)
            && !(Math.abs(fix.lat) < 0.001 && Math.abs(fix.lng) < 0.001)) {
          centroid = { lat: fix.lat, lng: fix.lng };
        }
      } catch { /* gps unavailable — fall through */ }
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
    // Course Cloud read-first: OSM-only means the proxy is WEAK for this course (no golfcourseapi
    // data), so let crowd-sourced geometry serve if it exists. origId is the DISPLAY id the share
    // path stores under (courseId here has been rewritten to '__osm_only__'). For proxy-strong
    // (golfcourseapi) courses we send neither, so the cloud never shadows their richer geometry.
    params.set('cloudFirst', '1');
    params.set('origId', courseId);
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
    /**
     * 2026-08-11 (Tim — "I still pull up Connecticut National and get green screens").
     *
     * THE GREEN SCREEN. This timeout was 12 SECONDS. Measured against production, the same request
     * returns anywhere from 3s to 20s — it fans out to golfcourseapi plus several Overpass polygon
     * queries, and Overpass latency is wildly variable. So the client was aborting a request that
     * was still on its way, falling back to `persisted ?? bundled ?? null`, and for an API course
     * with nothing cached that is NULL: no geometry, schematic markers, "waiting on your location",
     * green screen. Intermittent by construction — which is exactly the "little glimpses" he
     * described, where GPS and yardages worked now and then and mostly didn't.
     *
     * 30s is past the slowest response measured, and the request is still bounded. Cheap when the
     * server is fast (it returns as soon as it returns); decisive when it isn't.
     */
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) {
      console.warn('[courseGeometry] fetch failed:', res.status);
      // 2026-08-11 — if we bypassed bundled coords to try the engine and the engine failed, fall
      // back to those bundled coords rather than to nothing. Testers are mid-beta on these courses;
      // partially-wrong geometry still beats a blank hole view.
      return persisted ?? bundledFallback ?? buildBundledGeometry(courseId) ?? null;
    }
    const geo = (await res.json()) as CourseGeometry;
    geo.fetched_at = Date.now();
    // Force-key the result by the LOCAL courseId so getHoleGeometry()
    // and downstream consumers can read by the same id the rest of the
    // app uses. Without this, the cache stores under the upstream id
    // and SmartVision's getHoleGeometry(courseId='local:sunnyvale')
    // would miss the cache forever.
    geo.course_id = courseId;
    return await commitGeometry(courseId, geo);
  } catch (e) {
    console.warn('[courseGeometry] fetch exception:', e);
    return persisted ?? bundledFallback ?? buildBundledGeometry(courseId) ?? null;
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
      else {
        // 2026-07-28 (audit — DISCO-F2, CONFIRMED) — mirror the forward path's bundled-wins guard.
        // For a no-hint local course, bundled data/courses.ts coords are ground truth and MUST win over
        // OSM synthesis (OSM carries no hole numbers → scrambles routing). Without this, the weekly
        // background refresh silently overwrote the corrected bundled geometry with scrambled OSM — even
        // on fresh installs 7 days after first visit. Re-hydrate bundled + persist, and DON'T OSM-fetch.
        const bundled = buildBundledGeometry(courseId);
        if (bundled) {
          bundled.fetched_at = Date.now();
          bundled.course_id = courseId;
          memCache.set(courseId, bundled);
          await writePersistedCache(bundled);
          return;
        }
        upstreamId = '__osm_only__';
      }
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
    // Same 12s→30s reasoning as the primary fetch: a background refresh that always aborts is a
    // refresh that never happens, so a stale entry could never heal itself either.
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) {
      console.warn('[courseGeometry] background refresh failed:', res.status, courseId);
      return;
    }
    const geo = (await res.json()) as CourseGeometry;
    geo.fetched_at = Date.now();
    geo.course_id = courseId;
    await commitGeometry(courseId, geo);
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
