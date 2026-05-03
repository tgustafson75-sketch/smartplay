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
const TIMEOUT_MS = 10_000;
const EARTH_RADIUS_M = 6_371_000;

type Loc = { lat: number; lng: number };

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
