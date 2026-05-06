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

const apiUrl = (): string => process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8081';

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
}

// ─── Raw Golfbert response shapes (subset we use) ─────────────────────────────

interface RawGolfbertHole {
  id?: number | string;
  number?: number;
  par?: number;
  yardage?: number;
  vectors?: { type?: string; points?: LatLng[] }[];
  teeboxes?: { color?: string; latitude?: number; longitude?: number; yards?: number; par?: number }[];
  imageUrl?: string;
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
  const polygons: HolePolygon[] = (raw.vectors ?? [])
    .filter(v => Array.isArray(v.points) && v.points.length >= 3)
    .map(v => ({ type: normalizeVectorType(v.type), vectors: v.points! }));
  const teeboxes: Teebox[] = (raw.teeboxes ?? [])
    .filter(t => typeof t.latitude === 'number' && typeof t.longitude === 'number')
    .map(t => ({
      color: String(t.color ?? 'Unknown'),
      position: { lat: t.latitude!, lng: t.longitude! },
      yardage: typeof t.yards === 'number' ? t.yards : null,
      par: typeof t.par === 'number' ? t.par : null,
    }));
  return {
    holeNumber: typeof raw.number === 'number' ? raw.number : 0,
    par: typeof raw.par === 'number' ? raw.par : 4,
    yardage: typeof raw.yardage === 'number' ? raw.yardage : null,
    polygons,
    teeboxes,
    imageryUrl: typeof raw.imageUrl === 'string' ? raw.imageUrl : null,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Return Golfbert holes for a SmartPlay course id, OR null when the
 *  course has no Golfbert mapping (caller falls back to golfcourseapi).
 *  Supports both mapping forms — bulk courseId fetch (cheaper, single
 *  request) and explicit hole-id list (loop, one fetch per hole). The
 *  hole-list path is what Tim uses for Menifee Palms because Golfbert's
 *  public site exposes hole URLs but not always course URLs. */
export async function getGolfbertHolesForCourse(smartplayCourseId: string): Promise<GolfbertHole[] | null> {
  const mapping = getGolfbertMapping(smartplayCourseId);
  if (!mapping) return null;

  // Path A — bulk courseId fetch (preferred when available).
  if (mapping.golfbertCourseId) {
    try {
      const res = await fetch(proxyUrl({ action: 'holes', id: mapping.golfbertCourseId }), {
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        console.warn('[golfbert] courseId holes fetch failed', res.status);
      } else {
        const data = await res.json() as { resources?: RawGolfbertHole[]; holes?: RawGolfbertHole[] };
        const list = data.resources ?? data.holes ?? [];
        if (Array.isArray(list) && list.length > 0) {
          return list.map(normalizeHole).sort((a, b) => a.holeNumber - b.holeNumber);
        }
      }
    } catch (e) {
      console.warn('[golfbert] bulk fetch exception, falling through to hole list', e);
    }
  }

  // Path B — explicit hole id list. Fetch each one individually. Failed
  // fetches are skipped (we keep what worked); empty result returns null.
  if (mapping.golfbertHoleIds && mapping.golfbertHoleIds.length > 0) {
    const fetched = await Promise.all(
      mapping.golfbertHoleIds.map(async (hid) => {
        try {
          const r = await fetch(proxyUrl({ action: 'hole', id: String(hid) }), {
            signal: AbortSignal.timeout(12_000),
          });
          if (!r.ok) return null;
          const d = await r.json() as RawGolfbertHole;
          return normalizeHole(d);
        } catch (e) {
          console.warn('[golfbert] hole fetch exception for', hid, e);
          return null;
        }
      }),
    );
    const valid = fetched.filter((h): h is GolfbertHole => h !== null);
    if (valid.length === 0) return null;
    return valid.sort((a, b) => a.holeNumber - b.holeNumber);
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
