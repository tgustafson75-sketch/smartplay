import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors } from './_cors';
import { allowInference } from './_inferLimit';
import { providerFromHeaderSafe } from './_aiProvider';
import { getSmartPlaySupabase } from './_supabase';
import { readVisionChecks, recordVisionChecks, type StoredVisionCheck, type VisionVerdict } from './_courseCloud';
import { scanHoleImage } from './hole-scan';
import { frameForHole, pointFromTile, judgeHole, CHECK_TILE_PX, type LatLng } from '../services/holeVisionCheck';
import { MAPBOX_PUBLIC_FALLBACK } from '../utils/mapboxScale';
import { isValidGolfCoord } from '../utils/coordGuard';
import { haversineYards } from '../utils/geoDistance';

/**
 * api/course-verify — THE VISION CROSS-CHECK OF A COURSE THE ENGINE BUILT (2026-10-13).
 *
 * Tim: "we have computer vision to find a tee's green and its tee box… we can correlate our own
 * information pretty cheaply." The course engine pairs each hole's tee and green from the course
 * database and OpenStreetMap; where it has no tee it walks the routing from the previous green, and
 * nothing ever checked the pairing against the picture. This frames each paired hole north-up on
 * Mapbox satellite and asks our own vision read (api/hole-scan's scanHoleImage — one prompt, one set of
 * guards) where the hole's green and tee are, independently, then judges (services/holeVisionCheck):
 * verified · unconfirmed · suspect.
 *
 * Its own route because it cannot share course-geometry's budget (that build already spends ~80 of its
 * 90 s). Verdicts are stored once per course in Course Cloud (api/_courseCloud readVisionChecks /
 * recordVisionChecks) and reused while the checked points are still the course's points, so a course
 * is paid for once — every later player gets the verdicts for nothing.
 *
 *   POST /api/course-verify { courseId, holes: [{ hole, par?, yardage?, tee?: {lat,lng}, green: {lat,lng} }] }
 *   → { courseId, holes: [{ hole, verdict, greenOffYd, teeOffYd, visionGreen, cached }], scanned, reused }
 */

const MAX_HOLES = 36;
const CONCURRENCY = 6;
/** Leave headroom under the 300 s function limit for the Course Cloud write and the response. */
const DEADLINE_MS = 250_000;
const TILE_TIMEOUT_MS = 15_000;
/** A stored verdict is about these exact points; a move larger than this is a different pairing. */
const SAME_POINT_YD = 3;
const VERDICT_TTL_MS = 120 * 24 * 60 * 60 * 1000;

type InHole = { hole: number; par: number | null; yardage: number | null; tee: LatLng | null; green: LatLng };
export type OutHole = {
  hole: number;
  verdict: VisionVerdict;
  greenOffYd: number | null;
  teeOffYd: number | null;
  visionGreen: LatLng | null;
  cached: boolean;
};
/** Internal: whether the vision read actually happened (an unarrived tile is an outage, not a verdict). */
type Scanned = OutHole & { read: boolean };

const pointOf = (v: unknown): LatLng | null => {
  if (!v || typeof v !== 'object') return null;
  const o = v as { lat?: unknown; lng?: unknown };
  const lat = Number(o.lat), lng = Number(o.lng);
  return isValidGolfCoord(lat, lng) ? { lat, lng } : null;
};

export function parseHoles(raw: unknown): InHole[] {
  if (!Array.isArray(raw)) return [];
  const out: InHole[] = [];
  const seen = new Set<number>();
  for (const r of raw.slice(0, MAX_HOLES)) {
    const o = (r ?? {}) as Record<string, unknown>;
    const hole = Math.trunc(Number(o.hole));
    const green = pointOf(o.green);
    if (!Number.isFinite(hole) || hole < 1 || hole > MAX_HOLES || seen.has(hole) || !green) continue;
    const tee = pointOf(o.tee);
    // A "hole" longer than any real one is not a pairing worth paying to look at.
    if (tee && haversineYards(tee, green) > 800) continue;
    seen.add(hole);
    const par = Number(o.par), yardage = Number(o.yardage);
    out.push({ hole, tee, green, par: Number.isFinite(par) ? par : null, yardage: Number.isFinite(yardage) ? yardage : null });
  }
  return out;
}

/** A stored verdict still describes this hole: same green, same tee (or neither has one), not stale. */
export function storedStillApplies(s: StoredVisionCheck, h: InHole, now: number): boolean {
  if (!s.green || haversineYards(s.green, h.green) > SAME_POINT_YD) return false;
  if ((s.tee == null) !== (h.tee == null)) return false;
  if (s.tee && h.tee && haversineYards(s.tee, h.tee) > SAME_POINT_YD) return false;
  const at = Date.parse(s.checkedAt);
  return Number.isFinite(at) && now - at < VERDICT_TTL_MS;
}

async function fetchTileB64(center: LatLng, zoom: number): Promise<{ b64: string; mediaType: 'image/jpeg' | 'image/png' } | null> {
  const token = process.env.MAPBOX_TOKEN || process.env.EXPO_PUBLIC_MAPBOX_TOKEN || MAPBOX_PUBLIC_FALLBACK;
  const url = `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${center.lng},${center.lat},${zoom},0/${CHECK_TILE_PX}x${CHECK_TILE_PX}?access_token=${token}&attribution=false&logo=false`;
  const r = await fetch(url, { signal: AbortSignal.timeout(TILE_TIMEOUT_MS) }).catch(() => null);
  if (!r || !r.ok) return null;
  const type = r.headers.get('content-type') ?? '';
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 1000) return null;
  return { b64: buf.toString('base64'), mediaType: type.includes('png') ? 'image/png' : 'image/jpeg' };
}

async function checkOne(h: InHole, provider: ReturnType<typeof providerFromHeaderSafe>): Promise<Scanned> {
  const unconfirmed: Scanned = { hole: h.hole, verdict: 'unconfirmed', greenOffYd: null, teeOffYd: null, visionGreen: null, cached: false, read: false };
  const frame = frameForHole(h.tee, h.green);
  const tile = await fetchTileB64(frame.center, frame.zoom);
  if (!tile) return unconfirmed;
  const read = await scanHoleImage(
    { b64: tile.b64, mediaType: tile.mediaType, hole: h.hole, par: h.par, spanYards: frame.spanYards },
    provider,
  ).catch(() => null);
  if (!read || !('result' in read)) return unconfirmed;
  const r = read.result;
  const verdict = judgeHole(
    { tee: h.tee, green: h.green },
    {
      found_green: r.found_green,
      green_center: r.green_center ? pointFromTile(r.green_center, frame) : null,
      tee: r.tee ? pointFromTile(r.tee, frame) : null,
      confidence: r.confidence,
    },
  );
  return { hole: h.hole, ...verdict, cached: false, read: true };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  // Spends up to one vision read per hole: a tight per-IP budget. A course is normally checked once.
  if (!allowInference(req, res, 'course-verify', 6)) return;
  if (!process.env.GOOGLE_API_KEY && !process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
    return res.status(200).json({ configured: false, holes: [] });
  }
  const started = Date.now();
  try {
    const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {}) as Record<string, unknown>;
    const courseId = String(body.courseId ?? '').trim().slice(0, 120);
    const holes = parseHoles(body.holes);
    if (!courseId || holes.length === 0) return res.status(400).json({ error: 'courseId and holes (with greens) required' });

    const db = getSmartPlaySupabase();
    const stored = db ? await readVisionChecks(db, courseId).catch(() => [] as StoredVisionCheck[]) : [];
    const byHole = new Map(stored.map((s) => [s.hole, s] as const));
    const out: OutHole[] = [];
    const toScan: InHole[] = [];
    for (const h of holes) {
      const s = byHole.get(h.hole);
      if (s && storedStillApplies(s, h, started)) {
        out.push({ hole: h.hole, verdict: s.verdict, greenOffYd: null, teeOffYd: null, visionGreen: null, cached: true });
      } else {
        toScan.push(h);
      }
    }

    const provider = providerFromHeaderSafe(req.headers as Record<string, string | string[] | undefined>);
    const scanned: Scanned[] = [];
    let next = 0;
    const worker = async () => {
      while (next < toScan.length && Date.now() - started < DEADLINE_MS) {
        const h = toScan[next++];
        scanned.push(await checkOne(h, provider));
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, toScan.length) }, worker));

    // Store only what was actually READ. A hole whose tile or read never arrived is an outage, not a
    // verdict — storing it would stop the next player's check. A read that found no green IS stored
    // (unconfirmed): asking again would pay again for the same answer.
    if (db && scanned.length > 0) {
      const inById = new Map(holes.map((h) => [h.hole, h] as const));
      await recordVisionChecks(db, courseId, scanned
        .filter((s) => s.read)
        .map((s) => ({ hole: s.hole, verdict: s.verdict, tee: inById.get(s.hole)!.tee, green: inById.get(s.hole)!.green })),
      ).catch(() => 0);
    }

    const all: OutHole[] = [...out, ...scanned.map(({ read, ...h }) => { void read; return h; })].sort((a, b) => a.hole - b.hole);
    const counts = all.reduce((m, h) => ({ ...m, [h.verdict]: (m[h.verdict] ?? 0) + 1 }), {} as Record<string, number>);
    console.log(`[course-verify] ${courseId}: ${JSON.stringify(counts)} (scanned ${scanned.length}, reused ${out.length}, ${Date.now() - started}ms)`);
    return res.status(200).json({ courseId, holes: all, scanned: scanned.length, reused: out.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    console.error('[course-verify] exception:', msg);
    return res.status(500).json({ error: msg });
  }
}
