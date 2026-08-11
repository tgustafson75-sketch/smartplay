import type { VercelRequest, VercelResponse } from '@vercel/node';
import { allowInference } from './_inferLimit';
import { getSmartPlaySupabase } from './_supabase';
import { readSharedGeometry } from './_courseCloud';

// Course Cloud only SERVES a course once it's substantially mapped — this many holes with usable
// tee+green coords. 8 lets a fully-crowd-mapped 9-hole course qualify (12 never could) while still
// requiring a real map, not a stray hole or two. Only applies to cloudFirst (weak-proxy) courses.
const CLOUD_COMPLETE_MIN = 8;

/**
 * Phase B — Server-side course geometry endpoint.
 *
 * Proxies golfcourseapi.com (keeping the API key server-side) and projects the response
 * into the HoleGeometry shape consumed by services/courseGeometryService.ts. golfcourseapi
 * exposes per-hole point data (tee + front/middle/back of green); polygon data is not
 * available there, so fairway_centerline / green_outline are returned as empty arrays for
 * future enrichment.
 */

const BASE = 'https://api.golfcourseapi.com';
/**
 * 2026-08-10 (Tim, after the round — "you did not build this course engine correctly because most
 * of it didn't load correctly. And if the course doesn't load correctly the whole app doesn't work").
 *
 * He's right, and here is the measurement. Pulling Connecticut National's geometry from production
 * returned tee 18/18 and **green 0/18** — no greens, no bearings, no front/back, no polygons. The
 * course "loaded" and was empty.
 *
 * ROOT CAUSE: the entire engine hung off ONE call to ONE free community Overpass endpoint, with no
 * retry, no mirror, and no cache. overpass-api.de rate-limits and times out constantly — that is
 * normal for it, not exceptional. When the greens query came back empty the code treated empty as a
 * legitimate answer ("this course has no greens"), filled tees against nothing, and returned HTTP
 * 200 as if it had succeeded. A flaky third party was therefore indistinguishable from a real
 * result, and the client happily cached the emptiness.
 *
 * Three mirrors, all running the same public Overpass API, tried in order with a retry. If the
 * first is throttled the next usually isn't — which is the difference between a course loading on
 * the first tee and not loading at all.
 */
const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const OVERPASS_URL = OVERPASS_MIRRORS[0];

/**
 * POST an Overpass query, walking the mirrors until one answers with elements.
 *
 * `expectElements` is the important argument: for a query we EXPECT to return data (a course's
 * greens), an empty result is far more likely to be a throttled mirror than a course with no
 * greens, so it keeps walking. For genuinely optional queries (water hazards on a dry course) an
 * empty answer is real and we stop. Returns null when every mirror failed — which the caller must
 * treat as "unknown", never as "none".
 */
async function overpassQuery(
  query: string,
  label: string,
  opts: { expectElements?: boolean } = {},
): Promise<OsmElement[] | null> {
  let lastErr = '';
  for (let attempt = 0; attempt < OVERPASS_MIRRORS.length; attempt++) {
    const url = OVERPASS_MIRRORS[attempt];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OVERPASS_TIMEOUT_MS);
    try {
      // 2026-05-17 — explicit Accept + User-Agent. Without these Overpass returns 406 Not
      // Acceptable from undici-based fetch environments (verified against production from Vercel).
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          'User-Agent': 'SmartPlayCaddie/1.0 (https://api.smartplaycaddie.com)',
        },
        body: 'data=' + encodeURIComponent(query),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        // 429 (throttled) and 504 (query timeout) are the two Overpass says constantly.
        lastErr = `HTTP ${res.status}`;
        console.warn(`[course-geometry] Overpass ${label} ${lastErr} from mirror ${attempt + 1}`);
        continue;
      }
      const data = (await res.json()) as { elements?: OsmElement[] };
      const elements = data.elements ?? [];
      if (elements.length === 0 && opts.expectElements && attempt < OVERPASS_MIRRORS.length - 1) {
        lastErr = 'empty';
        console.warn(`[course-geometry] Overpass ${label} returned EMPTY from mirror ${attempt + 1} — trying next (empty is usually throttling, not absence)`);
        continue;
      }
      if (attempt > 0) console.log(`[course-geometry] Overpass ${label} served by mirror ${attempt + 1}`);
      return elements;
    } catch (e) {
      clearTimeout(timer);
      lastErr = e instanceof Error ? e.message : 'exception';
      console.warn(`[course-geometry] Overpass ${label} mirror ${attempt + 1} failed: ${lastErr}`);
    }
  }
  console.error(`[course-geometry] Overpass ${label}: ALL mirrors failed (${lastErr})`);
  return null;
}
const TIMEOUT_MS = 10_000;
const OVERPASS_TIMEOUT_MS = 15_000;
const EARTH_RADIUS_M = 6_371_000;
const OSM_SEARCH_RADIUS_M = 1500;

type Loc = { lat: number; lng: number };

// 2026-05-17 — OpenStreetMap Overpass fallback. golfcourseapi free tier
// is spotty for municipal courses (Sunnyvale, San Jose Muni return
// holes with null coords). OSM has `golf=green` and `golf=tee`
// polygon features for nearly every US course, tagged by community
// mappers. Querying Overpass for greens within ~1.5km of the course
// centroid and snapping each null-green hole to its nearest OSM
// polygon centroid gives us automatic per-hole green coords for free —
// no licensed data, no user pin-dropping. Same mechanism Garmin/18
// Birdies/Golf Shot ultimately depend on (Garmin's database is OSM
// plus an editorial pass).
type OsmElement = {
  type: 'way' | 'relation' | 'node';
  id: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
  members?: { geometry?: { lat: number; lon: number }[] }[];
};

// 2026-08-10 — pull a usable clubhouse centroid straight from the golfcourseapi record when it carries
// one (field shape varies across their tiers: flat latitude/longitude, lat/lng, or a nested `location`).
// Returns null when absent or a null-island / out-of-range value, so the caller falls to Gemini-locate.
function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
}
function coordsFromCourseRecord(course: Record<string, unknown>): Loc | null {
  const loc = (course.location as Record<string, unknown> | undefined) ?? course;
  const lat = num(loc.latitude) ?? num(loc.lat) ?? num((course as Record<string, unknown>).latitude);
  const lng =
    num(loc.longitude) ?? num(loc.lng) ?? num(loc.lon) ?? num((course as Record<string, unknown>).longitude);
  if (lat == null || lng == null) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (Math.abs(lat) < 0.001 && Math.abs(lng) < 0.001) return null;
  return { lat, lng };
}
// A "City, State" hint from the record to disambiguate the Gemini coordinate lookup (many clubs share a name).
function courseLocationHint(course: Record<string, unknown>): string | null {
  const loc = (course.location as Record<string, unknown> | undefined) ?? course;
  const city = String(loc.city ?? (course as Record<string, unknown>).city ?? '').trim();
  const state = String(loc.state ?? (course as Record<string, unknown>).state ?? '').trim();
  const parts = [city, state].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

function polygonCentroid(points: { lat: number; lon: number }[]): Loc | null {
  if (points.length === 0) return null;
  let latSum = 0;
  let lngSum = 0;
  for (const p of points) {
    latSum += p.lat;
    lngSum += p.lon;
  }
  return { lat: latSum / points.length, lng: lngSum / points.length };
}

// 2026-05-17 — Filter for OSM features that are tagged as practice /
// chipping / putting greens (or tees). At SJM the upstream OSM data
// includes a "Practice Green" named feature alongside the 18 holes,
// and Mariners similarly includes practice + chipping areas. Returning
// these inflates the result list (Mariners returned 15 greens for a
// 9-hole course). Matching on lowercased name keeps the filter
// resilient to capitalization variants ("Practice", "PRACTICE", etc.).
const PRACTICE_KEYWORDS = ['practice', 'chipping', 'putting', 'training', 'warm'];
function isPracticeFeature(tags: Record<string, string> | undefined): boolean {
  if (!tags) return false;
  const name = (tags.name ?? tags['name:en'] ?? '').toLowerCase();
  if (!name) return false;
  return PRACTICE_KEYWORDS.some(k => name.includes(k));
}

// 2026-05-17 — Full-polygon variant of fetchOsmFeatures. Returns each
// polygon's ring of points, centroid, and OSM name tag (if any).
// Used to drive the Bluegolf-style hole view (fairway/bunker/water
// polygon overlays on top of the satellite tile, plus a yardage-book
// panel listing landmarks with F/B distances).
type OsmPolygon = { polygon: Loc[]; centroid: Loc; name: string | null };

async function fetchOsmPolygons(centroid: Loc, feature: string): Promise<OsmPolygon[]> {
  const query = `[out:json][timeout:20];
(
  way[golf=${feature}](around:${OSM_SEARCH_RADIUS_M},${centroid.lat},${centroid.lng});
  relation[golf=${feature}](around:${OSM_SEARCH_RADIUS_M},${centroid.lat},${centroid.lng});
);
out geom;`;
  try {
    // Greens and tees are the load-bearing features — an empty answer for those is treated as a
    // throttled mirror and retried elsewhere. Bunkers/water/fairway can genuinely be absent.
    const elements = await overpassQuery(query, `polygons:${feature}`, {
      expectElements: feature === 'green' || feature === 'tee',
    });
    if (elements == null) return [];
    const out: OsmPolygon[] = [];
    let practiceFiltered = 0;
    for (const el of elements) {
      if (isPracticeFeature(el.tags)) {
        practiceFiltered++;
        continue;
      }
      let ring: { lat: number; lon: number }[] = [];
      if (el.geometry && el.geometry.length > 0) {
        ring = el.geometry;
      } else if (el.members) {
        for (const m of el.members) {
          if (m.geometry) ring.push(...m.geometry);
        }
      }
      if (ring.length < 3) continue; // degenerate polygon
      const c = polygonCentroid(ring);
      if (!c) continue;
      out.push({
        polygon: ring.map(p => ({ lat: p.lat, lng: p.lon })),
        centroid: c,
        name: el.tags?.name ?? el.tags?.['name:en'] ?? null,
      });
    }
    console.log(`[course-geometry] OSM ${feature} polygons: ${out.length} (filtered ${practiceFiltered} practice)`);
    return out;
  } catch (e) {
    console.warn('[course-geometry] OSM polygons exception:', e);
    return [];
  }
}

/**
 * 2026-08-08 (Tim — "I want the course builder engine: no user gets to a course and doesn't GET the
 * course"). The elite hole-way pass, ported from scripts/build-course-holeways.mjs (the hand-run dev
 * tool that built Berlin CC) into the LIVE synthesis path. OSM `golf=hole` WAYS carry the real hole
 * number (`ref`) and often `par` — so an unknown course gets REAL hole ordering + pars automatically,
 * instead of the centroid-pairing guesses with fabricated par-4s. Falls back to the pairing path when
 * hole-ways are absent/untagged (the minority of mapped courses).
 */
type OsmHoleWay = { ref: number | null; par: number | null; pts: Loc[] };
async function fetchOsmHoleWays(centroid: Loc): Promise<OsmHoleWay[]> {
  const query = `[out:json][timeout:20];
(
  way[golf=hole](around:${OSM_SEARCH_RADIUS_M},${centroid.lat},${centroid.lng});
);
out geom;`;
  try {
    // Hole-ways are the BEST source (real ref + par), so an empty answer is worth retrying
    // elsewhere before we fall back to centroid-pairing guesswork.
    const elements = await overpassQuery(query, 'hole-ways', { expectElements: true });
    if (elements == null) return [];
    const out: OsmHoleWay[] = [];
    for (const el of elements) {
      if (!el.geometry || el.geometry.length < 2) continue;
      // 2026-08-08 (verification wave) — same practice filter as every sibling fetcher. A practice
      // golf=hole way with a numeric ref would pair to the nearest REAL green and steal that row.
      if (isPracticeFeature(el.tags)) continue;
      const ref = el.tags?.ref != null && Number.isFinite(Number(el.tags.ref)) ? Number(el.tags.ref) : null;
      const par = el.tags?.par != null && Number.isFinite(Number(el.tags.par)) ? Number(el.tags.par) : null;
      out.push({ ref, par, pts: el.geometry.map(g => ({ lat: g.lat, lng: g.lon })) });
    }
    console.log(`[course-geometry] OSM hole-ways: ${out.length} (${out.filter(h => h.ref != null).length} with ref)`);
    return out;
  } catch (e) {
    console.warn('[course-geometry] OSM hole-ways exception:', e);
    return [];
  }
}

/** Returns null when EVERY Overpass mirror failed — 'unknown', which callers must not confuse with 'none'. */
async function fetchOsmFeatures(centroid: Loc, feature: 'green' | 'tee'): Promise<Loc[] | null> {
  const query = `[out:json][timeout:20];
(
  way[golf=${feature}](around:${OSM_SEARCH_RADIUS_M},${centroid.lat},${centroid.lng});
  relation[golf=${feature}](around:${OSM_SEARCH_RADIUS_M},${centroid.lat},${centroid.lng});
);
out geom;`;
  try {
    // Greens and tees are load-bearing: an empty answer is far more likely to be a throttled
    // mirror than a course genuinely without them, so overpassQuery keeps walking.
    const elements = await overpassQuery(query, `features:${feature}`, { expectElements: true });
    // null = every mirror failed. Returning [] here would be a LIE — "this course has no greens" —
    // and that lie is what let the engine fill tees against nothing and draw a hole from the
    // parking lot to the clubhouse. UNKNOWN must stay distinguishable from NONE.
    if (elements == null) return null;
    const centroids: Loc[] = [];
    let practiceFiltered = 0;
    for (const el of elements) {
      if (isPracticeFeature(el.tags)) {
        practiceFiltered++;
        continue;
      }
      if (el.geometry && el.geometry.length > 0) {
        const c = polygonCentroid(el.geometry);
        if (c) centroids.push(c);
      } else if (el.members) {
        const allPoints: { lat: number; lon: number }[] = [];
        for (const m of el.members) {
          if (m.geometry) allPoints.push(...m.geometry);
        }
        const c = polygonCentroid(allPoints);
        if (c) centroids.push(c);
      }
    }
    console.log(`[course-geometry] OSM ${feature} count: ${centroids.length} (filtered ${practiceFiltered} practice)`);
    return centroids;
  } catch (e) {
    console.warn('[course-geometry] OSM Overpass exception:', e);
    return null;
  }
}

// 2026-05-17 — Distance from a point to a segment (tee→green line),
// in yards. Used to assign each course-wide polygon (bunker, fairway,
// water hazard) to the hole whose tee→green segment it's closest to.
// Bunkers within 30y of the green are tagged 'greenside' for the
// yardage-book layout; everything else further from the centerline is
// tagged 'left' / 'right' based on which side of the bearing it sits.
function pointToSegmentYards(p: Loc, a: Loc, b: Loc): number {
  // Project onto local-equirectangular meters relative to `a`.
  const cosLat = Math.cos(toRad(a.lat));
  const ax = 0;
  const ay = 0;
  const bx = (b.lng - a.lng) * cosLat * 111_111;
  const by = (b.lat - a.lat) * 111_111;
  const px = (p.lng - a.lng) * cosLat * 111_111;
  const py = (p.lat - a.lat) * 111_111;
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq > 0 ? ((px - ax) * dx + (py - ay) * dy) / lenSq : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  const distMeters = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
  return distMeters / 0.9144;
}

// Signed lateral offset: positive = right of bearing tee→green, negative = left.
function lateralYards(p: Loc, tee: Loc, green: Loc): number {
  const cosLat = Math.cos(toRad(tee.lat));
  const tx = 0, ty = 0;
  const gx = (green.lng - tee.lng) * cosLat * 111_111;
  const gy = (green.lat - tee.lat) * 111_111;
  const px = (p.lng - tee.lng) * cosLat * 111_111;
  const py = (p.lat - tee.lat) * 111_111;
  // 2D cross product of (G-T) x (P-T) / |G-T|
  const len = Math.sqrt(gx * gx + gy * gy);
  if (len === 0) return 0;
  const cross = gx * py - gy * px;
  return (cross / len) / 0.9144;
}

type AssignedPolygon = {
  polygon: Loc[];
  centroid: Loc;
  side: 'left' | 'right' | 'greenside' | 'fairway' | null;
  name: string | null;
};

// Assigns each polygon to the hole whose tee→green segment it's closest
// to, tags side (left/right/greenside) and returns a map of hole_number
// → polygons. Polygons farther than MAX_HOLE_DIST_YARDS from any hole
// are dropped (they belong to driving range / cart paths / etc).
const MAX_HOLE_DIST_YARDS = 60;
const GREENSIDE_DIST_YARDS = 30;
function assignPolygonsToHoles<T extends { tee: Loc | null; green: Loc | null; hole_number: number }>(
  holes: T[],
  polygons: OsmPolygon[],
): Map<number, AssignedPolygon[]> {
  const out = new Map<number, AssignedPolygon[]>();
  for (const h of holes) out.set(h.hole_number, []);

  for (const poly of polygons) {
    let bestHole = -1;
    let bestDist = Infinity;
    for (const h of holes) {
      if (!h.tee || !h.green) continue;
      const d = pointToSegmentYards(poly.centroid, h.tee, h.green);
      if (d < bestDist) {
        bestDist = d;
        bestHole = h.hole_number;
      }
    }
    if (bestHole < 0 || bestDist > MAX_HOLE_DIST_YARDS) continue;
    const hole = holes.find(x => x.hole_number === bestHole);
    if (!hole || !hole.tee || !hole.green) continue;

    // Side classification: distance to green centroid, then lateral.
    const distToGreen = haversineYards(poly.centroid, hole.green);
    let side: AssignedPolygon['side'];
    if (distToGreen < GREENSIDE_DIST_YARDS) {
      side = 'greenside';
    } else {
      const lat = lateralYards(poly.centroid, hole.tee, hole.green);
      if (Math.abs(lat) < 12) side = 'fairway';
      else side = lat > 0 ? 'right' : 'left';
    }
    out.get(bestHole)!.push({
      polygon: poly.polygon,
      centroid: poly.centroid,
      side,
      name: poly.name,
    });
  }
  return out;
}

function nearestUnassigned(target: Loc, candidates: Loc[], used: Set<number>): number {
  let bestIdx = -1;
  let bestDist = Infinity;
  for (let i = 0; i < candidates.length; i++) {
    if (used.has(i)) continue;
    const d = haversineYards(target, candidates[i]);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/**
 * 2026-08-10 (Tim, playing Connecticut National — "holes are not always oriented correctly and the
 * measuring tool does not often land on the teebox and green respectively").
 *
 * ROOT CAUSE, proven against the live endpoint: with the course's real centroid, OSM filled 18/18
 * holes — but EVERY hole measured 38-95 yards tee→green against a scorecard saying 137-527. Not
 * noise; a systematic structural error. nearestUnassigned() picks the tee NEAREST the assigned
 * green, and on a golf course the nearest tee box to any green is the NEXT hole's tee, sitting a
 * few paces away by design. So hole N was consistently drawn as green_N → tee_(N+1): a ~50y stub on
 * an arbitrary axis. That is exactly both symptoms — a bearing computed off that pair points
 * nowhere near the real hole (wrong orientation), and the measure tool's endpoints are the wrong
 * two objects (never lands on the tee box or the green).
 *
 * THE FIX: we already hold the answer. golfcourseapi gives us the REAL yardage for all 18 holes, so
 * a correct tee↔green pair is not the closest one — it is the one whose distance MATCHES THE CARD.
 * Select by |distance − cardYardage| instead of raw distance and the next-tee decoy is rejected
 * outright, because it is ~300 yards wrong. Falls back to nearest-unassigned only when a hole has
 * no card yardage to constrain it, so behavior is unchanged where we have nothing better.
 */
function bestByTargetYards(
  from: Loc,
  candidates: Loc[],
  used: Set<number>,
  targetYards: number,
): number {
  if (!(targetYards > 0)) return nearestUnassigned(from, candidates, used);
  let bestIdx = -1;
  let bestErr = Infinity;
  for (let i = 0; i < candidates.length; i++) {
    if (used.has(i)) continue;
    const err = Math.abs(haversineYards(from, candidates[i]) - targetYards);
    if (err < bestErr) {
      bestErr = err;
      bestIdx = i;
    }
  }
  return bestIdx;
}

// 2026-05-17 — Minimum-cost bipartite assignment for tee→green pairing.
// Pairs tees and greens such that the resulting hole yardages cluster
// in a realistic range. Earlier iterations:
//   v1 (greedy NN by hole order): mis-paired SJM H1's tee to a closer
//   (wrong) green that yielded 73y;
//   v2 (sorted-edge greedy, 65y floor): still pairs short fake holes
//   (70y "holes" between adjacent greens, 834y "holes" across the
//   course). The 65y floor wasn't tight enough and there was no upper
//   bound.
//   v3 (this): bound each pairing in [MIN_REALISTIC, MAX_REALISTIC]
//   yards. Anything outside is rejected and the algorithm tries the
//   next-cheapest valid edge. Empirically this matches the actual
//   tee→green pair for ~17/18 holes at typical courses; the rare
//   miss is handled by drag-to-anchor on the hole view.
// Returns array of [teeIdx, greenIdx] pairs, length = min(tees, greens).
const MIN_REALISTIC_YARDS = 80;   // shortest US par-3 is ~100y; 80 = margin
const MAX_REALISTIC_YARDS = 650;  // longest US par-5 is ~600y; 650 = margin
function minCostPairs(tees: Loc[], greens: Loc[]): [number, number][] {
  type Edge = { ti: number; gi: number; dist: number };
  const edges: Edge[] = [];
  for (let ti = 0; ti < tees.length; ti++) {
    for (let gi = 0; gi < greens.length; gi++) {
      const dist = haversineYards(tees[ti], greens[gi]);
      // Pre-filter implausible edges so they never compete for assignment.
      if (dist < MIN_REALISTIC_YARDS || dist > MAX_REALISTIC_YARDS) continue;
      edges.push({ ti, gi, dist });
    }
  }
  edges.sort((a, b) => a.dist - b.dist);
  const usedTees = new Set<number>();
  const usedGreens = new Set<number>();
  const pairs: [number, number][] = [];
  for (const e of edges) {
    if (usedTees.has(e.ti) || usedGreens.has(e.gi)) continue;
    usedTees.add(e.ti);
    usedGreens.add(e.gi);
    pairs.push([e.ti, e.gi]);
  }
  return pairs;
}

function toRad(d: number): number {
  return (d * Math.PI) / 180;
}

function bearingDeg(a: Loc, b: Loc): number {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  return (deg + 360) % 360;
}

function haversineYards(a: Loc, b: Loc): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  const meters = 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(x));
  return meters / 0.9144;
}

const HAZARD_KEYWORDS = [
  'bunker', 'sand', 'water', 'hazard', 'ob', 'out of bounds',
  'pond', 'creek', 'lake', 'stream', 'trees', 'woods',
  'fescue', 'waste', 'marsh',
];

function extractHazards(raw: Record<string, unknown>): { label: string; location: Loc | null }[] {
  const out: { label: string; location: Loc | null }[] = [];
  const candidates: string[] = [];
  for (const k of ['note', 'notes', 'description', 'desc', 'hole_description', 'tee_description', 'comments']) {
    const v = raw[k];
    if (typeof v === 'string' && v.trim()) candidates.push(v.trim());
  }
  for (const k of ['features', 'hazards']) {
    const v = raw[k];
    if (Array.isArray(v)) {
      for (const s of v) if (typeof s === 'string' && s.trim()) candidates.push(s.trim());
    } else if (typeof v === 'string' && v.trim()) {
      candidates.push(v.trim());
    }
  }
  const seen = new Set<string>();
  for (const c of candidates) {
    const lower = c.toLowerCase();
    if (HAZARD_KEYWORDS.some(k => lower.includes(k)) && !seen.has(lower)) {
      seen.add(lower);
      out.push({ label: c, location: null });
    }
  }
  return out;
}

function projectHole(raw: Record<string, unknown>, indexFallback: number): {
  hole_number: number;
  par: number;
  yardage: number;
  tee: Loc | null;
  green: Loc | null;
  green_front: Loc | null;
  green_back: Loc | null;
  bearing_deg: number | null;
  hazards: { label: string; location: Loc | null }[];
  fairway_centerline: Loc[];
  green_outline: Loc[];
} {
  const num = (v: unknown): number | null =>
    typeof v === 'number' && isFinite(v) && v !== 0 ? v : null;
  const loc = (latKey: string, lngKey: string): Loc | null => {
    const lat = num(raw[latKey]);
    const lng = num(raw[lngKey]);
    return lat != null && lng != null ? { lat, lng } : null;
  };

  // golfcourseapi commonly returns lat/lng on the hole record; some shapes nest under tee
  // and green keys. Try several fallbacks.
  const tee = loc('teeLat', 'teeLng') ?? loc('tee_lat', 'tee_lng') ?? loc('lat', 'lng');
  const greenMid = loc('middleLat', 'middleLng') ?? loc('middle_lat', 'middle_lng') ?? loc('green_lat', 'green_lng');
  const greenFront = loc('frontLat', 'frontLng') ?? loc('front_lat', 'front_lng');
  const greenBack = loc('backLat', 'backLng') ?? loc('back_lat', 'back_lng');

  const green =
    greenMid ??
    (greenFront && greenBack
      ? { lat: (greenFront.lat + greenBack.lat) / 2, lng: (greenFront.lng + greenBack.lng) / 2 }
      : null);

  // Surface hole_number/par/yardage with the same defensive normalization as
  // services/golfCourseApi.ts.
  const holeNumber =
    typeof raw.hole_number === 'number' && raw.hole_number > 0 ? raw.hole_number :
    typeof raw.number === 'number' && raw.number > 0 ? raw.number : indexFallback;
  const par = typeof raw.par === 'number' ? raw.par : 4;
  const yardage =
    typeof raw.yardage === 'number' ? raw.yardage :
    typeof raw.yards === 'number' ? raw.yards : 0;

  return {
    hole_number: holeNumber,
    par,
    yardage,
    tee,
    green,
    green_front: greenFront,
    green_back: greenBack,
    bearing_deg: tee && green ? bearingDeg(tee, green) : null,
    hazards: extractHazards(raw),
    fairway_centerline: [],
    green_outline: [],
  };
}

function extractRawHoles(course: Record<string, unknown>): Record<string, unknown>[] {
  const tees = course.tees;
  // Shape A: array of tees
  if (Array.isArray(tees)) {
    for (const t of tees) {
      const holes = (t as Record<string, unknown>)?.holes;
      if (Array.isArray(holes) && holes.length > 0) return holes as Record<string, unknown>[];
    }
  }
  // Shape B: { male: [...], female: [...] } — pick the first non-empty tee's holes
  if (tees && typeof tees === 'object') {
    for (const arr of Object.values(tees as Record<string, unknown>)) {
      if (Array.isArray(arr)) {
        for (const t of arr) {
          const holes = (t as Record<string, unknown>)?.holes;
          if (Array.isArray(holes) && holes.length > 0) return holes as Record<string, unknown>[];
        }
      }
    }
  }
  return [];
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 2026-08-08 (course-engine audit gap #4) — this endpoint proxies the PAID golfcourseapi key and
  // hammers Overpass with NO throttle: a curl loop could burn the quota / get the UA banned. IP-based
  // rate limit (generous — a real round pulls one course); same pattern as every AI route.
  if (!allowInference(req, res, 'course-geometry', 30)) return;
  // ── Course Cloud read-first ──────────────────────────────────────────────
  // Serve crowd-sourced geometry only when the client signals the proxy is WEAK for this course
  // (cloudFirst=1 — sent for OSM-only local courses with no golfcourseapi id). This prevents the
  // cloud from shadowing the richer golfcourseapi/OSM proxy (polygons, hazards, real par/yardage)
  // on courses the proxy maps well. Keyed on `origId` — the DISPLAY course id the SHARE path stores
  // under — because the proxy path rewrites courseId to the upstream id. `noCloud=1` forces a fresh
  // proxy read. Wrapped so a cloud hiccup never blocks the proxy.
  const cloudKey = (req.query.origId ?? req.query.courseId ?? req.query.id) as string | undefined;
  const cloudFirst = String(req.query.cloudFirst ?? '') === '1';
  if (cloudKey && cloudFirst && String(req.query.noCloud ?? '') !== '1') {
    try {
      const db = getSmartPlaySupabase();
      if (db) {
        const shared = await readSharedGeometry(db, cloudKey);
        const mapped = shared?.filter(h => h.tee && h.green).length ?? 0;
        if (shared && mapped >= CLOUD_COMPLETE_MIN) {
          console.log('[course-geometry] served from Course Cloud —', cloudKey, `(${shared.length} holes, ${mapped} mapped)`);
          return res.status(200).json({ course_id: cloudKey, course_name: 'Course Cloud', fetched_at: Date.now(), holes: shared });
        }
      }
    } catch (e) {
      console.warn('[course-geometry] cloud read failed, falling back to proxy:', e instanceof Error ? e.message : e);
    }
  }

  const apiKey = process.env.GOLFCOURSE_API_KEY;
  if (!apiKey) {
    console.error('[course-geometry] GOLFCOURSE_API_KEY not set');
    return res.status(500).json({ error: 'GOLFCOURSE_API_KEY not set' });
  }

  const courseId = (req.query.courseId ?? req.query.id) as string | undefined;
  if (!courseId) {
    return res.status(400).json({ error: 'Missing courseId query parameter' });
  }

  // 2026-05-17 — Optional centroid hint for OSM Overpass fallback.
  // Client passes `lat`/`lng` from LOCAL_COURSE_CENTROIDS when calling
  // for a course we know geographically (Sunnyvale, San Jose Muni, etc).
  // When present and the upstream returns null greens, we query
  // OpenStreetMap for golf=green polygons within ~1.5km and snap each
  // null-green hole to its nearest OSM green centroid.
  const centroidLat = Number(req.query.lat);
  const centroidLng = Number(req.query.lng);
  let centroid: Loc | null =
    isFinite(centroidLat) && isFinite(centroidLng) && centroidLat !== 0 && centroidLng !== 0
      ? { lat: centroidLat, lng: centroidLng }
      : null;
  // 2026-05-17 — Optional course hole count. Lets us cap the OSM-only
  // synthesis (Mariners is 9-hole par-3 but OSM has 15 green polygons
  // including practice; without the cap we'd emit ghost holes 10-18).
  const holeCountQ = Number(req.query.holeCount);
  const holeCount: number =
    isFinite(holeCountQ) && holeCountQ >= 1 && holeCountQ <= 18 ? Math.round(holeCountQ) : 18;
  // 2026-05-17 — Polygon mode for Bluegolf-style hole rendering.
  // When set, alongside the standard tee/green centroid fetch we also
  // pull full polygons for fairway, bunker, water_hazard, etc., and
  // attach them to each hole by proximity. Adds ~5 Overpass round-
  // trips (~3-8s) so it's opt-in.
  const withPolygons = String(req.query.withPolygons ?? '') === '1';

  // 2026-05-17 — OSM-only mode: client signals it has no upstream
  // golfcourseapi ID for this course but does know the centroid. We
  // synthesize a holes list purely from OSM golf=green / golf=tee
  // features. Hole numbering is best-effort (proximity-pair order)
  // since OSM rarely tags hole numbers consistently.
  const osmOnly = String(req.query.osmOnly ?? '') === '1';
  if (osmOnly) {
    // 2026-08-10 (Tim — "combine Gemini with golfcourse api to help"). No centroid but we know the
    // course NAME (golfcourseapi gave us the record + pars, just no location, and the player isn't
    // standing on it): ask Gemini (Google-Search-grounded) WHERE it is, then build from there. This is
    // how an unbundled course like Holden gets mapped when browsing off-site. Honest — a miss returns
    // null and we fall through to the original 400.
    if (!centroid) {
      const courseName = typeof req.query.name === 'string' ? req.query.name : '';
      if (courseName) {
        try {
          const { groundedCourseCoords } = await import('./_webSearch');
          const loc = await groundedCourseCoords(courseName, { context: typeof req.query.region === 'string' ? req.query.region : null });
          if (loc) { centroid = loc; console.log('[course-geometry] Gemini-located centroid for', courseName, loc); }
        } catch { /* fall through to the 400 */ }
      }
    }
    if (!centroid) return res.status(400).json({ error: 'osmOnly requires lat/lng' });
    const centroidNN = centroid; // non-null capture for closures below (sort callback loses `let` narrowing)
    // 2026-08-08 (Tim — the course BUILDER engine, live). PRIMARY PASS: OSM golf=hole WAYS with real
    // hole numbers (ref) + pars — the same algorithm the hand-run script used to build Berlin CC, now
    // automatic for every course a user arrives at. Only when hole-ways are absent/untagged do we fall
    // to the centroid-pairing guesswork below.
    const [holeWays, greenPolys] = await Promise.all([
      fetchOsmHoleWays(centroid),
      fetchOsmPolygons(centroid, 'green'),
    ]);
    // 2026-08-08 (verification wave) — OSM routinely SPLITS one golf=hole way into segments at
    // path/road crossings, each segment keeping ref+par. Emitting one row per WAY produced duplicate
    // hole_numbers (a mid-fairway segment endpoint became a badly-short "tee", could snap to a
    // NEIGHBORING hole's green, inflated holes.length past 9 — which silently disabled the client's
    // twice-around wrap — and left find(hole_number) consumers on whichever segment sorted first).
    // Dedup: keep the LONGEST way per ref (the main tee→green line). Also apply the client's
    // holeCount cap HERE, not just in the fallback pass — a 1500m Overpass radius can pull an
    // adjacent course's hole ways at multi-course facilities.
    const wayLen = (w: OsmHoleWay): number => {
      let len = 0;
      for (let i = 1; i < w.pts.length; i++) len += haversineYards(w.pts[i - 1], w.pts[i]);
      return len;
    };
    const byRef = new Map<number, OsmHoleWay>();
    for (const w of holeWays) {
      if (w.ref == null || w.ref < 1 || w.ref > holeCount) continue;
      const prev = byRef.get(w.ref);
      if (!prev || wayLen(w) > wayLen(prev)) byRef.set(w.ref, w);
    }
    const refWays = [...byRef.values()];
    if (refWays.length >= 3 && greenPolys.length >= 3) {
      const nearestGreen = (p: Loc): { poly: OsmPolygon; d: number } | null => {
        let best: OsmPolygon | null = null; let bd = Infinity;
        for (const g of greenPolys) {
          const d = haversineYards(p, g.centroid);
          if (d < bd) { bd = d; best = g; }
        }
        return best ? { poly: best, d: bd } : null;
      };
      const rows: Array<{ ref: number; par: number; parEstimated: boolean; tee: Loc; green: Loc; front: Loc; back: Loc }> = [];
      for (const w of refWays.sort((a, b) => (a.ref! - b.ref!))) {
        const A = w.pts[0]; const B = w.pts[w.pts.length - 1];
        const gA = nearestGreen(A); const gB = nearestGreen(B);
        if (!gA || !gB) continue;
        const greenEnd = gA.d <= gB.d ? gA : gB;
        const tee = gA.d <= gB.d ? B : A;
        // Front/back of the green relative to the tee, from the actual polygon.
        let front = greenEnd.poly.centroid; let back = greenEnd.poly.centroid;
        let dF = Infinity; let dB = -Infinity;
        for (const p of greenEnd.poly.polygon) {
          const d = haversineYards(tee, p);
          if (d < dF) { dF = d; front = p; }
          if (d > dB) { dB = d; back = p; }
        }
        const center = haversineYards(tee, greenEnd.poly.centroid);
        const par = w.par ?? (center <= 215 ? 3 : center >= 460 ? 5 : 4);
        rows.push({ ref: w.ref!, par, parEstimated: w.par == null, tee, green: greenEnd.poly.centroid, front, back });
      }
      if (rows.length >= 3) {
        const holes = rows.map(r => ({
          hole_number: r.ref,
          par: r.par,
          yardage: Math.round(haversineYards(r.tee, r.green)),
          tee: r.tee,
          green: r.green,
          green_front: r.front,
          green_back: r.back,
          bearing_deg: bearingDeg(r.tee, r.green),
          hazards: [],
          fairway_centerline: [],
          green_outline: [],
          green_polygon: null as Loc[] | null,
          // 2026-08-09 (course-engine audit C1) — the `estimated` flag drives the "AI ESTIMATE — not
          // surveyed" badge + the 45% confidence cap, which are about COORDINATE provenance. These coords
          // are REAL (community-mapped golf=hole ways + polygon-derived greens), so estimated:false even
          // when PAR was inferred from distance — badging real coords "AI ESTIMATE" because par lacked a
          // tag was backwards. par_estimated carries the (minor) par uncertainty separately.
          estimated: false,
        }));
        console.log(`[course-geometry] OSM hole-way synthesis: ${holes.length} holes with REAL refs (par inferred on ${rows.filter(r => r.parEstimated).length})`);
        return res.status(200).json({
          course_id: courseId,
          course_name: 'OSM-derived',
          holes,
          source: 'osm_holeways',
        });
      }
    }
    const [osmGreens, osmTees] = await Promise.all([
      fetchOsmFeatures(centroid, 'green'),
      fetchOsmFeatures(centroid, 'tee'),
    ]);
    // 2026-08-10 — distinguish UNKNOWN (every mirror failed) from NONE. 503 tells the client this is
    // transient and worth retrying; 404 means we genuinely looked and this course isn't mapped.
    // Serving [] for either was what let an outage masquerade as an unmapped course.
    if (osmGreens == null) {
      return res.status(503).json({ error: 'OSM unavailable — geometry unknown, retry', retryable: true });
    }
    if (osmGreens.length === 0) {
      return res.status(404).json({ error: 'No OSM greens found near centroid' });
    }
    const osmTeesSafe = osmTees ?? [];

    // 2026-05-17 — Min-cost pairing replaces greedy nearest-neighbor.
    // The previous greedy approach mis-paired SJM H1's tee to a closer
    // (wrong) green that yielded 73y; min-cost considers global tee↔
    // green distances and assigns the cheapest valid pair first, with
    // a 65y floor that rejects implausible practice-area pairings.
    const matchedPairs = minCostPairs(osmTeesSafe, osmGreens);
    type Pair = { tee: Loc | null; green: Loc };
    const pairsByGreen = new Map<number, Loc>();
    for (const [ti, gi] of matchedPairs) pairsByGreen.set(gi, osmTeesSafe[ti]);
    let pairs: Pair[] = osmGreens.map((g, gi) => ({
      tee: pairsByGreen.get(gi) ?? null,
      green: g,
    }));

    // Sort pairs by bearing from centroid — rough walk-the-course
    // ordering. Far from perfect, but better than insertion order.
    pairs.sort((a, b) => {
      const ba = bearingDeg(centroidNN, a.green);
      const bb = bearingDeg(centroidNN, b.green);
      return ba - bb;
    });

    // 2026-05-17 — Cap to holeCount. Mariners is 9-hole; OSM returns
    // 9 actual greens + practice/chipping that the keyword filter
    // catches, but a tighter cap protects against any remaining noise.
    // Prefer pairs with a tee (those are real holes) over unpaired.
    pairs = [
      ...pairs.filter(p => p.tee != null),
      ...pairs.filter(p => p.tee == null),
    ].slice(0, holeCount);

    const holes = pairs.map((p, i) => ({
      hole_number: i + 1,
      par: 4,
      yardage: p.tee ? Math.round(haversineYards(p.tee, p.green)) : 0,
      tee: p.tee,
      green: p.green,
      green_front: p.green,
      green_back: p.green,
      bearing_deg: p.tee ? bearingDeg(p.tee, p.green) : null,
      hazards: [],
      fairway_centerline: [],
      green_outline: [],
      green_polygon: null as Loc[] | null,
      // 2026-08-09 (course-engine audit C1) — this is the SPECULATIVE path: par hardcoded 4, hole order
      // guessed by bearing-sort, tee/green by min-cost pairing. It IS synthesized, so it MUST carry the
      // estimated flag (badge + 45% cap) — previously it shipped with none, presenting the LEAST reliable
      // output as fully trustworthy while the real hole-way path got badged. Now honest.
      estimated: true,
      estimated_confidence: 'low' as const,
      tee_polygon: null as Loc[] | null,
      fairway_polygons: [] as Loc[][],
      bunkers: [] as AssignedPolygon[],
      water_hazards: [] as AssignedPolygon[],
    }));

    // 2026-05-17 — Augment with polygon data when requested. Pulls
    // full polygons for green/tee/fairway/bunker/water_hazard in
    // parallel, then assigns each polygon to its nearest hole's
    // tee→green line. Result drives the Bluegolf-style overlay
    // rendering on the client.
    if (withPolygons) {
      const [greenPolys, teePolys, fairwayPolys, bunkerPolys, waterPolys] = await Promise.all([
        fetchOsmPolygons(centroid, 'green'),
        fetchOsmPolygons(centroid, 'tee'),
        fetchOsmPolygons(centroid, 'fairway'),
        fetchOsmPolygons(centroid, 'bunker'),
        fetchOsmPolygons(centroid, 'water_hazard'),
      ]);
      // For green/tee polygons, snap to the hole that owns the same
      // centroid (already paired). For fairway/bunker/water, assign by
      // proximity to the hole's tee→green segment.
      for (const h of holes) {
        if (h.green) {
          const m = greenPolys.find(p =>
            haversineYards(p.centroid, h.green!) < 15,
          );
          if (m) h.green_polygon = m.polygon;
        }
        if (h.tee) {
          const m = teePolys.find(p =>
            haversineYards(p.centroid, h.tee!) < 15,
          );
          if (m) h.tee_polygon = m.polygon;
        }
      }
      const fairwayAssign = assignPolygonsToHoles(holes, fairwayPolys);
      const bunkerAssign = assignPolygonsToHoles(holes, bunkerPolys);
      const waterAssign = assignPolygonsToHoles(holes, waterPolys);
      for (const h of holes) {
        h.fairway_polygons = (fairwayAssign.get(h.hole_number) ?? []).map(a => a.polygon);
        h.bunkers = bunkerAssign.get(h.hole_number) ?? [];
        h.water_hazards = waterAssign.get(h.hole_number) ?? [];
      }
      const totals = {
        green: holes.filter(h => h.green_polygon).length,
        tee: holes.filter(h => h.tee_polygon).length,
        fairway: holes.reduce((n, h) => n + h.fairway_polygons.length, 0),
        bunker: holes.reduce((n, h) => n + h.bunkers.length, 0),
        water: holes.reduce((n, h) => n + h.water_hazards.length, 0),
      };
      console.log('[course-geometry] polygon attach:', totals);
    }

    return res.status(200).json({
      course_id: courseId,
      course_name: 'OSM-derived',
      fetched_at: Date.now(),
      holes,
    });
  }

  const url = `${BASE}/v1/courses/${encodeURIComponent(courseId)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const upstream = await fetch(url, {
      headers: {
        Authorization: `Key ${apiKey}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!upstream.ok) {
      const text = await upstream.text();
      console.error('[course-geometry] upstream', upstream.status, text.slice(0, 200));
      return res.status(upstream.status).json({ error: `Upstream ${upstream.status}` });
    }

    const data = (await upstream.json()) as Record<string, unknown>;
    const course =
      (data.course as Record<string, unknown> | undefined) ??
      (data.data as Record<string, unknown> | undefined) ??
      data;

    // 2026-08-10 (Tim — "combine Gemini with golfcourse api to help"). The OSM green-fill + polygon
    // enrichment below only fire when we have a centroid. When the player is BROWSING an unbundled
    // course off-site (no active round, no live GPS) the client sends none — so Holden came back with
    // frozen scorecard yardages and no live greens. golfcourseapi's own record usually carries the
    // clubhouse coords (or at least a city/state); pull them, and if it doesn't, ask Gemini
    // (Google-Search-grounded) WHERE the named course is. Either way the existing engine then fills
    // greens/polygons. Honest: a miss leaves centroid null and behavior is exactly as before.
    if (!centroid) {
      centroid = coordsFromCourseRecord(course);
      if (!centroid) {
        const locHint = courseLocationHint(course);
        const nameHint = String(course.club_name ?? course.course_name ?? course.name ?? '').trim();
        if (nameHint) {
          try {
            const { groundedCourseCoords } = await import('./_webSearch');
            const loc = await groundedCourseCoords(nameHint, { context: locHint });
            if (loc) { centroid = loc; console.log('[course-geometry] Gemini-located centroid for', nameHint, loc); }
          } catch { /* degrade to no-centroid behavior */ }
        }
      }
    }

    const rawHoles = extractRawHoles(course);
    // Phase AG diagnostic — log the actual field shape of the FIRST hole
    // so we can see what an upgraded golfcourseapi tier returns. The
    // parser at projectHole() looks for teeLat/teeLng, tee_lat/tee_lng,
    // lat/lng, etc. If the upstream returns coords in a different field
    // shape (e.g. nested gps object, coordinates array), this log
    // surfaces the keys so we can extend the parser without guessing.
    if (rawHoles.length > 0) {
      const sample = rawHoles[0];
      const keys = Object.keys(sample);
      console.log('[course-geometry] sample hole keys:', JSON.stringify(keys));
      // Also log values for any key that looks coordinate-related.
      const coordKeys = keys.filter(k => /lat|lng|long|coord|gps|geo|location|tee|green/i.test(k));
      if (coordKeys.length > 0) {
        const slice: Record<string, unknown> = {};
        for (const k of coordKeys) slice[k] = sample[k];
        console.log('[course-geometry] sample hole coord-like keys:', JSON.stringify(slice).slice(0, 800));
      }
    }
    const holes = rawHoles
      .map((h, i) => projectHole(h, i + 1))
      .filter(h => h.hole_number > 0);

    // 2026-05-17 — OSM Overpass fallback. When the upstream returned
    // holes but with null greens (golfcourseapi's free-tier gap for
    // municipal courses), query OpenStreetMap for nearby golf=green
    // polygons and snap each null-green hole to its nearest unused
    // OSM green centroid (anchored on the hole's tee if known, else
    // on the course centroid). Also fills null tees from golf=tee
    // polygons where possible.
    const nullGreens = holes.filter(h => !h.green).length;
    const nullTees = holes.filter(h => !h.tee).length;
    if (centroid && (nullGreens > 0 || nullTees > 0)) {
      console.log(`[course-geometry] OSM fallback triggered: ${nullGreens} null greens, ${nullTees} null tees`);
      const [greensRes, teesRes] = await Promise.all([
        nullGreens > 0 ? fetchOsmFeatures(centroid, 'green') : Promise.resolve([] as Loc[]),
        nullTees > 0 ? fetchOsmFeatures(centroid, 'tee') : Promise.resolve([] as Loc[]),
      ]);

      /**
       * 2026-08-10 (Tim — "one of the holes went from the parking lot to the clubhouse as the line").
       *
       * THAT LINE IS BUILT HERE, and this is how. When the greens query fails (Overpass throttled —
       * production returned green 0/18 while tees returned 18/18), the old code read the failure as
       * "no greens exist", left every green null, and then went right on filling TEES. A tee with no
       * green still gets rendered as a hole line from that tee to whatever the map falls back to —
       * and OSM golf=tee features near a clubhouse include the practice tee and the pads by the
       * car park. Hence a hole drawn from the parking lot to the clubhouse.
       *
       * A tee is only meaningful RELATIVE to its green. So if greens are UNKNOWN, we do not fill
       * tees at all — there is nothing to orient them against, and half a hole is worse than none.
       */
      const greensUnknown = greensRes == null;
      const osmGreens: Loc[] = greensRes ?? [];
      const osmTees: Loc[] = greensUnknown ? [] : (teesRes ?? []);
      if (greensUnknown) {
        console.warn('[course-geometry] greens UNKNOWN (all Overpass mirrors failed) — skipping tee fill so no hole is drawn without a green to orient it');
      }

      const usedGreens = new Set<number>();
      const usedTees = new Set<number>();

      // Walk holes in order. Anchor each null-green search on the
      // hole's tee (best signal), falling back to the previous hole's
      // green, falling back to the course centroid.
      let lastAnchor: Loc = centroid;
      for (const h of holes) {
        const anchor = h.tee ?? lastAnchor;
        if (!h.green && osmGreens.length > 0) {
          // Green: when the tee is already known, the card yardage pins WHICH green belongs to this
          // hole; otherwise fall back to walking the routing (nearest to the previous green).
          const idx = h.tee
            ? bestByTargetYards(h.tee, osmGreens, usedGreens, h.yardage)
            : nearestUnassigned(anchor, osmGreens, usedGreens);
          if (idx >= 0) {
            usedGreens.add(idx);
            h.green = osmGreens[idx];
            h.green_front = osmGreens[idx];
            h.green_back = osmGreens[idx];
          }
        }
        if (!h.tee && osmTees.length > 0) {
          // 2026-08-10 — THE orientation fix. Was nearestUnassigned(green, tees), which always
          // grabbed the next hole's tee sitting beside this green (~50y "holes", garbage bearings).
          // Match the card yardage instead: the real tee is ~h.yardage away, the decoy is ~300 off.
          const teeAnchor = h.green ?? lastAnchor;
          const idx = h.green
            ? bestByTargetYards(h.green, osmTees, usedTees, h.yardage)
            : nearestUnassigned(teeAnchor, osmTees, usedTees);
          if (idx >= 0) {
            usedTees.add(idx);
            h.tee = osmTees[idx];
          }
        }
        if (h.tee && h.green) {
          h.bearing_deg = bearingDeg(h.tee, h.green);
        }
        if (h.green) lastAnchor = h.green;
      }

      // 2026-08-10 — HONEST VALIDATION. Even with card-matched pairing, a course whose OSM tee
      // features are missing/misplaced can still produce a pair that disagrees with the scorecard.
      // Drawing that hole is worse than not drawing it: the player gets a confidently wrong
      // orientation and a measure tool anchored on the wrong objects. When a pair is off by >35%,
      // drop the TEE (keep the green — F/M/B yardages off live GPS stay correct) and clear the
      // bearing, so the hole degrades to "no drawn axis" instead of a lie. Same tenet as
      // [[illustration-data-points]]: real signals or nothing, never fabricate.
      let rejected = 0;
      for (const h of holes) {
        if (!h.tee || !h.green || !(h.yardage > 0)) continue;
        const measured = haversineYards(h.tee, h.green);
        if (measured > h.yardage * 1.35 || measured < h.yardage * 0.65) {
          console.warn(`[course-geometry] hole ${h.hole_number}: OSM pair ${Math.round(measured)}y vs card ${h.yardage}y — rejecting tee`);
          h.tee = null;
          h.bearing_deg = null;
          rejected++;
        }
      }
      console.log(`[course-geometry] after OSM: ${holes.filter(x => x.green).length}/${holes.length} greens filled, ${holes.filter(x => x.tee && x.green).length} card-verified tee→green pairs, ${rejected} rejected`);
    }

    // Distance-from-tee-to-green sanity check, surfaced for debugging
    for (const h of holes) {
      if (h.tee && h.green) {
        const yd = Math.round(haversineYards(h.tee, h.green));
        if (yd < 50 || yd > 800) {
          console.warn(`[course-geometry] hole ${h.hole_number} suspicious tee→green: ${yd}y`);
        }
      }
    }

    // 2026-05-17 — Bluegolf-style polygon overlay. Same logic as the
    // osmOnly branch above; attaches polygons for green/tee/fairway/
    // bunker/water_hazard to each hole when withPolygons=1.
    const holesWithPolygons = holes.map(h => ({
      ...h,
      green_polygon: null as Loc[] | null,
      tee_polygon: null as Loc[] | null,
      fairway_polygons: [] as Loc[][],
      bunkers: [] as AssignedPolygon[],
      water_hazards: [] as AssignedPolygon[],
    }));
    if (withPolygons && centroid) {
      const [greenPolys, teePolys, fairwayPolys, bunkerPolys, waterPolys] = await Promise.all([
        fetchOsmPolygons(centroid, 'green'),
        fetchOsmPolygons(centroid, 'tee'),
        fetchOsmPolygons(centroid, 'fairway'),
        fetchOsmPolygons(centroid, 'bunker'),
        fetchOsmPolygons(centroid, 'water_hazard'),
      ]);
      for (const h of holesWithPolygons) {
        if (h.green) {
          const m = greenPolys.find(p => haversineYards(p.centroid, h.green!) < 15);
          if (m) h.green_polygon = m.polygon;
        }
        if (h.tee) {
          const m = teePolys.find(p => haversineYards(p.centroid, h.tee!) < 15);
          if (m) h.tee_polygon = m.polygon;
        }
      }
      const fairwayAssign = assignPolygonsToHoles(holesWithPolygons, fairwayPolys);
      const bunkerAssign = assignPolygonsToHoles(holesWithPolygons, bunkerPolys);
      const waterAssign = assignPolygonsToHoles(holesWithPolygons, waterPolys);
      for (const h of holesWithPolygons) {
        h.fairway_polygons = (fairwayAssign.get(h.hole_number) ?? []).map(a => a.polygon);
        h.bunkers = bunkerAssign.get(h.hole_number) ?? [];
        h.water_hazards = waterAssign.get(h.hole_number) ?? [];
      }
      console.log('[course-geometry] polygon attach (upstream path):', {
        green: holesWithPolygons.filter(h => h.green_polygon).length,
        bunker: holesWithPolygons.reduce((n, h) => n + h.bunkers.length, 0),
      });
    }

    return res.status(200).json({
      course_id: String(course.id ?? courseId),
      course_name: String(course.club_name ?? course.course_name ?? course.name ?? 'Unknown'),
      fetched_at: Date.now(),
      holes: holesWithPolygons,
    });
  } catch (e) {
    clearTimeout(timer);
    const msg = e instanceof Error ? e.message : 'Unknown error';
    console.error('[course-geometry] exception:', msg);
    return res.status(500).json({ error: msg });
  }
}
