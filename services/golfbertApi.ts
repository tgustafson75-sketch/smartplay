/**
 * Client-side Golfbert helpers.
 *
 * Routes all Golfbert calls through /api/golfbert-proxy so the API key
 * stays server-side. Returns normalized shapes the rest of the app
 * (SmartVision, course detail, caddie context) consumes.
 *
 * When a course doesn't have a Golfbert mapping (constants/golfbertCourses.ts),
 * these helpers return null — callers fall back to the existing
 * golfcourseapi geometry path.
 */

import { getGolfbertMapping } from '../constants/golfbertCourses';
import { getApiBaseUrl } from './apiBase';

const apiUrl = (): string => getApiBaseUrl();

function proxyUrl(params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  return `${apiUrl()}/api/golfbert-proxy?${qs}`;
}

// ─── Types ────────────────────────────────────────────────────────────────────

/** Minimal lat/lng pair Golfbert returns inside polygon vector lists. */
export interface LatLng { lat: number; lng: number }

/** A polygon overlay for one hole element (green / fairway / bunker /
 *  water / rough). Coordinates are an ordered ring (no auto-close). */
export interface HolePolygon {
  type: 'green' | 'fairway' | 'bunker' | 'water' | 'rough' | 'tee' | 'other';
  vectors: LatLng[];
}

/** Tee-box position with its rated yardage and color label (Black, Blue,
 *  White, Gold, Red, etc — Golfbert uses color names per course). */
export interface Teebox {
  color: string;
  position: LatLng;
  yardage: number | null;
  par: number | null;
}

/** A single point Golfbert places on a hole — tee colors (Blue/White/Red
 *  /Gold/Black) and the pin (`Flag`). Uses Golfbert's native `long` key. */
export interface GolfbertPointVector {
  type: string;
  lat: number;
  long: number;
}

/** Per-hole Golfbert data used by SmartVision and the lie-aware caddie. */
export interface GolfbertHole {
  holeNumber: number;
  par: number;
  /** Default scorecard yardage for the white/middle tee. */
  yardage: number | null;
  polygons: HolePolygon[];
  teeboxes: Teebox[];
  /** Direct URL to a Golfbert satellite image of this hole, if available. */
  imageryUrl: string | null;
  /** Green center coord per /holes endpoint. Single point (no F/M/B
   *  triplet). Used by resolveGreenCoords when present. */
  flagcoords: { lat: number; long: number } | null;
  /** Per-hole tee + flag points from /holes endpoint. type carries the
   *  tee color label ('White'|'Blue'|'Gold'|'Red'|'Black') or 'Flag'. */
  vectors: GolfbertPointVector[];
  /** Bounding box for the hole's associated tile (lng on x, lat on y). */
  range: { x: { min: number; max: number }; y: { min: number; max: number } } | null;
  /** Tile rotation in radians (alignment for the satellite image). */
  rotation: number | null;
}

// ─── Raw Golfbert response shapes (subset we use) ─────────────────────────────

interface RawGolfbertHole {
  id?: number | string;
  number?: number;
  par?: number;
  yardage?: number;
  // /hole/{id} detail endpoint returns vectors as polygon point lists;
  // /holes endpoint returns vectors as single points with lat/long.
  // Accept both shapes — normalizeHole routes each to the right field.
  vectors?: Array<{ type?: string; points?: LatLng[]; lat?: number; long?: number }>;
  teeboxes?: { color?: string; latitude?: number; longitude?: number; yards?: number; par?: number }[];
  imageUrl?: string;
  flagcoords?: { lat?: number; long?: number };
  range?: { x?: { min?: number; max?: number }; y?: { min?: number; max?: number } };
  rotation?: number;
}

// ─── Normalization ────────────────────────────────────────────────────────────

function normalizeVectorType(t: string | undefined): HolePolygon['type'] {
  const v = (t ?? '').toLowerCase();
  if (v === 'green') return 'green';
  if (v === 'fairway') return 'fairway';
  if (v === 'bunker' || v === 'sand') return 'bunker';
  if (v === 'water' || v === 'hazard') return 'water';
  if (v === 'rough') return 'rough';
  if (v === 'tee' || v === 'teebox') return 'tee';
  return 'other';
}

function normalizeHole(raw: RawGolfbertHole): GolfbertHole {
  const rawVectors = raw.vectors ?? [];
  const polygons: HolePolygon[] = rawVectors
    .filter(v => Array.isArray(v.points) && v.points.length >= 3)
    .map(v => ({ type: normalizeVectorType(v.type), vectors: v.points! }));
  const vectors: GolfbertPointVector[] = rawVectors
    .filter(v => typeof v.lat === 'number' && typeof v.long === 'number' && Number.isFinite(v.lat) && Number.isFinite(v.long))
    .map(v => ({ type: String(v.type ?? 'Unknown'), lat: v.lat!, long: v.long! }));
  const teeboxes: Teebox[] = (raw.teeboxes ?? [])
    .filter(t => typeof t.latitude === 'number' && typeof t.longitude === 'number')
    .map(t => ({
      color: String(t.color ?? 'Unknown'),
      position: { lat: t.latitude!, lng: t.longitude! },
      yardage: typeof t.yards === 'number' ? t.yards : null,
      par: typeof t.par === 'number' ? t.par : null,
    }));
  const fc = raw.flagcoords;
  const flagcoords = fc && typeof fc.lat === 'number' && typeof fc.long === 'number' && Number.isFinite(fc.lat) && Number.isFinite(fc.long)
    ? { lat: fc.lat, long: fc.long }
    : null;
  const r = raw.range;
  const range = r && r.x && r.y
    && typeof r.x.min === 'number' && typeof r.x.max === 'number'
    && typeof r.y.min === 'number' && typeof r.y.max === 'number'
    ? { x: { min: r.x.min, max: r.x.max }, y: { min: r.y.min, max: r.y.max } }
    : null;
  return {
    holeNumber: typeof raw.number === 'number' ? raw.number : 0,
    par: typeof raw.par === 'number' ? raw.par : 4,
    yardage: typeof raw.yardage === 'number' ? raw.yardage : null,
    polygons,
    teeboxes,
    imageryUrl: typeof raw.imageUrl === 'string' ? raw.imageUrl : null,
    flagcoords,
    vectors,
    range,
    rotation: typeof raw.rotation === 'number' ? raw.rotation : null,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

// Synchronous cache of Golfbert holes keyed by SmartPlay courseId so the
// priority chain in resolveGreenCoords / resolveTeeCoords can read
// Golfbert coords without going async. Populated by
// getGolfbertHolesForCourse on successful fetch (typically triggered by
// SmartVision mount); empty until then, in which case the resolvers
// fall through to courseHoles / geometryCache.
const golfbertCache = new Map<string, GolfbertHole[]>();

/** Synchronous lookup for a single hole from the cache. Returns null
 *  when the course's holes haven't been fetched yet OR the requested
 *  hole isn't in the response. */
export function getCachedGolfbertHole(smartplayCourseId: string, holeNumber: number): GolfbertHole | null {
  const holes = golfbertCache.get(smartplayCourseId);
  if (!holes) return null;
  return holes.find(h => h.holeNumber === holeNumber) ?? null;
}

/** Return Golfbert holes for a SmartPlay course id, OR null when the
 *  course has no Golfbert mapping (caller falls back to golfcourseapi). */
export async function getGolfbertHolesForCourse(smartplayCourseId: string): Promise<GolfbertHole[] | null> {
  const mapping = getGolfbertMapping(smartplayCourseId);
  if (!mapping) return null;

  // 2026-06-14 (audit — redundant work) — serve from the in-memory cache once
  // we've fetched this course's holes. The prior code wrote the cache but never
  // read it here, so every hole switch re-fetched the whole course over the
  // network. Course holes don't change mid-session, so the cache is authoritative.
  const cached = golfbertCache.get(smartplayCourseId);
  if (cached && cached.length > 0) return cached;

  try {
    const res = await fetch(proxyUrl({ action: 'holes', id: mapping.golfbertCourseId }), {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.warn('[golfbert] courseId holes fetch failed', res.status);
      return null;
    }
    const data = await res.json() as { resources?: RawGolfbertHole[]; holes?: RawGolfbertHole[] };
    const list = data.resources ?? data.holes ?? [];
    if (!Array.isArray(list) || list.length === 0) return null;
    const sorted = list.map(normalizeHole).sort((a, b) => a.holeNumber - b.holeNumber);
    golfbertCache.set(smartplayCourseId, sorted);
    return sorted;
  } catch (e) {
    console.warn('[golfbert] holes fetch exception', e);
    return null;
  }
}

// ─── Coord extraction helpers (resolveGreenCoords / resolveTeeCoords) ─────────

/** Return the green center coord for a Golfbert hole (the pin position
 *  Golfbert anchors as the green centroid). Normalizes Golfbert's
 *  `long` key to our standard `lng`. Returns null when missing. */
export function getGolfbertGreenCoord(hole: GolfbertHole): { lat: number; lng: number } | null {
  const fc = hole.flagcoords;
  if (!fc) return null;
  if (!Number.isFinite(fc.lat) || !Number.isFinite(fc.long)) return null;
  return { lat: fc.lat, lng: fc.long };
}

/** Tee preference order — White (player default) → Blue → Gold → Red.
 *  Black is intentionally omitted (championship tee, rarely the actual
 *  play set; Tim's testers play forward of it). */
const TEE_PREFERENCE: readonly string[] = ['White', 'Blue', 'Gold', 'Red'];

/** Return the preferred tee coord for a Golfbert hole, walking the
 *  fallback order White → Blue → Gold → Red. Normalizes `long` → `lng`.
 *  Returns null when none of the preferred tee colors are present. */
export function getGolfbertTeeCoord(hole: GolfbertHole): { lat: number; lng: number } | null {
  const vectors = hole.vectors;
  if (!Array.isArray(vectors) || vectors.length === 0) return null;
  for (const preferred of TEE_PREFERENCE) {
    const match = vectors.find(v => v.type === preferred);
    if (match && Number.isFinite(match.lat) && Number.isFinite(match.long)) {
      return { lat: match.lat, lng: match.long };
    }
  }
  return null;
}

/** Fetch a single hole's polygon detail. Useful when SmartVision wants
 *  per-hole data without paying the cost of the full course response. */
export async function getGolfbertHole(golfbertHoleId: string | number): Promise<GolfbertHole | null> {
  try {
    const res = await fetch(proxyUrl({ action: 'hole', id: String(golfbertHoleId) }), {
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const data = await res.json() as RawGolfbertHole;
    return normalizeHole(data);
  } catch (e) {
    console.warn('[golfbert] getHole exception', e);
    return null;
  }
}

/** Get a satellite image URL for a hole. Returns the upstream image URL
 *  Golfbert serves; SmartVision feeds it directly into <Image source>. */
export async function getGolfbertHoleImageryUrl(golfbertHoleId: string | number, size?: string): Promise<string | null> {
  try {
    const params: Record<string, string> = { action: 'imagery', id: String(golfbertHoleId) };
    if (size) params.size = size;
    const res = await fetch(proxyUrl(params), { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return null;
    const data = await res.json() as { url?: string; imageUrl?: string };
    return data.url ?? data.imageUrl ?? null;
  } catch (e) {
    console.warn('[golfbert] getImagery exception', e);
    return null;
  }
}

/** Health check — used by /tools to verify Golfbert is configured + reachable. */
export async function golfbertHealth(): Promise<{ ok: boolean; reason?: string }> {
  try {
    const res = await fetch(`${apiUrl()}/api/golfbert-proxy?action=health`, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return { ok: false, reason: `Upstream ${res.status}: ${t.slice(0, 100)}` };
    }
    const j = await res.json() as { ok?: boolean; hostConfigured?: boolean };
    return { ok: !!j.ok, reason: j.hostConfigured ? undefined : 'GOLFBERT_API_HOST not set' };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'Unknown error' };
  }
}
