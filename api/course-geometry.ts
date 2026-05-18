import type { VercelRequest, VercelResponse } from '@vercel/node';

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
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OVERPASS_TIMEOUT_MS);
  try {
    const res = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'User-Agent': 'SmartPlayCaddie/1.0 (https://smartplay-beta.vercel.app)',
      },
      body: 'data=' + encodeURIComponent(query),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      console.warn('[course-geometry] OSM polygons', feature, 'status', res.status);
      return [];
    }
    const data = (await res.json()) as { elements?: OsmElement[] };
    const out: OsmPolygon[] = [];
    let practiceFiltered = 0;
    for (const el of data.elements ?? []) {
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
    clearTimeout(timer);
    console.warn('[course-geometry] OSM polygons exception:', e);
    return [];
  }
}

async function fetchOsmFeatures(centroid: Loc, feature: 'green' | 'tee'): Promise<Loc[]> {
  const query = `[out:json][timeout:20];
(
  way[golf=${feature}](around:${OSM_SEARCH_RADIUS_M},${centroid.lat},${centroid.lng});
  relation[golf=${feature}](around:${OSM_SEARCH_RADIUS_M},${centroid.lat},${centroid.lng});
);
out geom;`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OVERPASS_TIMEOUT_MS);
  try {
    // 2026-05-17 — explicit Accept + User-Agent. Without these Overpass
    // returns 406 Not Acceptable from undici-based fetch environments
    // (verified against production: status 406 from Vercel us-east-1).
    // The Overpass docs ask for a User-Agent; the Accept header tells
    // their content negotiator we'll take JSON.
    const res = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'User-Agent': 'SmartPlayCaddie/1.0 (https://smartplay-beta.vercel.app)',
      },
      body: 'data=' + encodeURIComponent(query),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      console.warn('[course-geometry] OSM Overpass', feature, 'status', res.status);
      return [];
    }
    const data = (await res.json()) as { elements?: OsmElement[] };
    const elements = data.elements ?? [];
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
    clearTimeout(timer);
    console.warn('[course-geometry] OSM Overpass exception:', e);
    return [];
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
  const centroid: Loc | null =
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
    if (!centroid) return res.status(400).json({ error: 'osmOnly requires lat/lng' });
    const [osmGreens, osmTees] = await Promise.all([
      fetchOsmFeatures(centroid, 'green'),
      fetchOsmFeatures(centroid, 'tee'),
    ]);
    if (osmGreens.length === 0) {
      return res.status(404).json({ error: 'No OSM greens found near centroid' });
    }

    // 2026-05-17 — Min-cost pairing replaces greedy nearest-neighbor.
    // The previous greedy approach mis-paired SJM H1's tee to a closer
    // (wrong) green that yielded 73y; min-cost considers global tee↔
    // green distances and assigns the cheapest valid pair first, with
    // a 65y floor that rejects implausible practice-area pairings.
    const matchedPairs = minCostPairs(osmTees, osmGreens);
    type Pair = { tee: Loc | null; green: Loc };
    const pairsByGreen = new Map<number, Loc>();
    for (const [ti, gi] of matchedPairs) pairsByGreen.set(gi, osmTees[ti]);
    let pairs: Pair[] = osmGreens.map((g, gi) => ({
      tee: pairsByGreen.get(gi) ?? null,
      green: g,
    }));

    // Sort pairs by bearing from centroid — rough walk-the-course
    // ordering. Far from perfect, but better than insertion order.
    pairs.sort((a, b) => {
      const ba = bearingDeg(centroid, a.green);
      const bb = bearingDeg(centroid, b.green);
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
      const [osmGreens, osmTees] = await Promise.all([
        nullGreens > 0 ? fetchOsmFeatures(centroid, 'green') : Promise.resolve([] as Loc[]),
        nullTees > 0 ? fetchOsmFeatures(centroid, 'tee') : Promise.resolve([] as Loc[]),
      ]);

      const usedGreens = new Set<number>();
      const usedTees = new Set<number>();

      // Walk holes in order. Anchor each null-green search on the
      // hole's tee (best signal), falling back to the previous hole's
      // green, falling back to the course centroid.
      let lastAnchor: Loc = centroid;
      for (const h of holes) {
        const anchor = h.tee ?? lastAnchor;
        if (!h.green && osmGreens.length > 0) {
          const idx = nearestUnassigned(anchor, osmGreens, usedGreens);
          if (idx >= 0) {
            usedGreens.add(idx);
            h.green = osmGreens[idx];
            h.green_front = osmGreens[idx];
            h.green_back = osmGreens[idx];
          }
        }
        if (!h.tee && osmTees.length > 0) {
          const teeAnchor = h.green ?? lastAnchor;
          const idx = nearestUnassigned(teeAnchor, osmTees, usedTees);
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
      console.log(`[course-geometry] after OSM: ${holes.filter(x => x.green).length}/${holes.length} greens filled`);
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
