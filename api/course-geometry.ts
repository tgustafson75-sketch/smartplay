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
    for (const el of elements) {
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
    console.log('[course-geometry] OSM', feature, 'count:', centroids.length);
    return centroids;
  } catch (e) {
    clearTimeout(timer);
    console.warn('[course-geometry] OSM Overpass exception:', e);
    return [];
  }
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
    // Pair each green with its nearest tee. Order pairs by their
    // centroid bearing from the course centroid — gives a rough
    // walk-the-course ordering. Far from perfect, but better than
    // random.
    const usedTees = new Set<number>();
    type Pair = { tee: Loc | null; green: Loc };
    const pairs: Pair[] = osmGreens.map(g => {
      const idx = nearestUnassigned(g, osmTees, usedTees);
      let tee: Loc | null = null;
      if (idx >= 0) {
        usedTees.add(idx);
        tee = osmTees[idx];
      }
      return { tee, green: g };
    });
    pairs.sort((a, b) => {
      const ba = bearingDeg(centroid, a.green);
      const bb = bearingDeg(centroid, b.green);
      return ba - bb;
    });
    const holes = pairs.slice(0, 18).map((p, i) => ({
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
    }));
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

    return res.status(200).json({
      course_id: String(course.id ?? courseId),
      course_name: String(course.club_name ?? course.course_name ?? course.name ?? 'Unknown'),
      fetched_at: Date.now(),
      holes,
    });
  } catch (e) {
    clearTimeout(timer);
    const msg = e instanceof Error ? e.message : 'Unknown error';
    console.error('[course-geometry] exception:', msg);
    return res.status(500).json({ error: msg });
  }
}
