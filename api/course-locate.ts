import type { VercelRequest, VercelResponse } from '@vercel/node';
import { allowInference } from './_inferLimit';
import { applyCors } from './_cors';

/**
 * api/course-locate.ts — the COURSE-DOWNLOAD ENGINE's locator (2026-08-06, Tim — "build the course
 * download engine / future API; it may be my in with Arccos and Meta").
 *
 * Arccos-style "you drive up, it knows where you are": POST a GPS fix → the golf courses AT/NEAR that
 * location, so the client can offer a one-tap on-demand download of THAT course's data. This is the clean,
 * self-describing edge of the engine — a partner (Arccos / Meta glasses) can call the SAME endpoint to ask
 * "given this location, what course is the player on?" without shipping our whole app.
 *
 * Source: Google Places Nearby Search (type=golf_course) — the same GOOGLE_API_KEY course-places.ts uses,
 * server-side only (never in the client bundle). Best-effort: no key / Places-not-enabled → { courses: [] }.
 *
 *   POST /api/course-locate  { lat: number, lng: number, radius_m?: number, limit?: number }
 *   → { courses: [{ name, place_id, lat, lng, distance_m, vicinity, rating, open_now }], source }
 */
const KEY =
  process.env.GOOGLE_MAPS_KEY ||
  process.env.GOOGLE_API_KEY ||
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY ||
  '';
const TIMEOUT_MS = 8_000;
const DEFAULT_RADIUS_M = 8_000; // ~5 miles — a course you could be at / driving to
const MAX_RADIUS_M = 40_000;
const DEFAULT_LIMIT = 8;

function isNum(v: unknown): v is number { return typeof v === 'number' && Number.isFinite(v); }

// Haversine metres — so results are sorted nearest-first and carry an honest distance.
function distanceM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s)));
}

type PlaceResult = {
  name?: string;
  place_id?: string;
  vicinity?: string;
  rating?: number;
  business_status?: string;
  opening_hours?: { open_now?: boolean };
  geometry?: { location?: { lat?: number; lng?: number } };
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 2026-08-08 (server audit #4) — paid Google Places behind zero throttle; IP-limit it (partner-shaped
  // endpoint stays keyless by design, but a curl loop can't burn quota anymore).
  if (!allowInference(req, res, 'course-locate', 30)) return;
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!KEY) return res.status(200).json({ courses: [], source: 'places', error: 'not_configured' });

  try {
    const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {}) as {
      lat?: unknown; lng?: unknown; radius_m?: unknown; limit?: unknown;
    };
    const lat = body.lat, lng = body.lng;
    if (!isNum(lat) || !isNum(lng)) return res.status(400).json({ error: 'lat and lng required' });
    const radius = isNum(body.radius_m) ? Math.min(MAX_RADIUS_M, Math.max(200, Math.round(body.radius_m))) : DEFAULT_RADIUS_M;
    const limit = isNum(body.limit) ? Math.min(20, Math.max(1, Math.round(body.limit))) : DEFAULT_LIMIT;

    const url =
      `https://maps.googleapis.com/maps/api/place/nearbysearch/json` +
      `?location=${lat},${lng}&radius=${radius}&type=golf_course&key=${KEY}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!r.ok) return res.status(200).json({ courses: [], source: 'places', error: `HTTP ${r.status}` });
    const data = (await r.json()) as { status?: string; error_message?: string; results?: PlaceResult[] };
    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      console.log(`[course-locate] Places nearbysearch status=${data.status} — ${data.error_message || ''}`);
      return res.status(200).json({ courses: [], source: 'places', error: data.status || 'places_error' });
    }

    const courses = (data.results ?? [])
      .map((p) => {
        const plat = p.geometry?.location?.lat;
        const plng = p.geometry?.location?.lng;
        if (!isNum(plat) || !isNum(plng)) return null;
        // Skip permanently-closed places so we never offer a course that doesn't exist anymore.
        if (p.business_status === 'CLOSED_PERMANENTLY') return null;
        return {
          name: (p.name ?? '').trim(),
          place_id: p.place_id ?? null,
          lat: plat,
          lng: plng,
          distance_m: distanceM(lat, lng, plat, plng),
          vicinity: (p.vicinity ?? '').trim() || null,
          rating: isNum(p.rating) ? p.rating : null,
          open_now: p.opening_hours?.open_now ?? null,
        };
      })
      .filter((c): c is NonNullable<typeof c> => c != null && c.name.length > 0)
      .sort((a, b) => a.distance_m - b.distance_m)
      .slice(0, limit);

    return res.status(200).json({ courses, source: 'places' });
  } catch (e) {
    console.error('[course-locate] failed:', e instanceof Error ? e.message : e);
    return res.status(200).json({ courses: [], source: 'places', error: 'exception' });
  }
}
