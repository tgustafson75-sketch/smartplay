/**
 * 2026-07-23 — Course Cloud server store (crowd-sourced hole geometry).
 *
 * Shared by:
 *   • api/course-geometry-share.ts — POST: record one contributor's derived geometry.
 *   • api/course-geometry.ts        — GET:  read the merged canonical geometry BEFORE the
 *                                            golfcourseapi/OSM proxy fallback.
 *
 * Two tables (migration 0006): `course_geometry_reports` keeps every raw submission
 * (one row per course/hole/contributor); `course_geometry` holds the merged canonical row
 * clients read. Merge rule = best source rank, then highest confidence, then most recent.
 * Coords only — no PII (see 0006 for the privacy contract).
 */
import type { getSmartPlaySupabase } from './_supabase';

type Db = NonNullable<ReturnType<typeof getSmartPlaySupabase>>;

const REPORTS = 'course_geometry_reports';
const CANON = 'course_geometry';

// Higher = more trusted. A lone AI-vision guess loses to OSM/bundled/on-foot data.
const SOURCE_RANK: Record<string, number> = { ai_vision: 1, user_walk: 2, osm: 3, bundled: 4 };
const rank = (s: string) => SOURCE_RANK[s] ?? 0;

// Confidence label bucket used on read. Exported for tests.
export function bucketConfidence(c: number): 'high' | 'medium' | 'low' {
  return c >= 0.75 ? 'high' : c >= 0.5 ? 'medium' : 'low';
}

/**
 * Pure merge rule: from all reports for one hole, choose the canonical winner —
 * best source rank, then highest confidence, then most recent. Exported for tests.
 */
export function chooseBestReport<T extends { source?: unknown; confidence?: unknown; created_at?: unknown }>(
  reports: T[],
): T | null {
  if (!Array.isArray(reports) || reports.length === 0) return null;
  return [...reports].sort((a, b) => {
    const r = rank(String(b.source)) - rank(String(a.source));
    if (r !== 0) return r;
    const c = (Number(b.confidence) || 0) - (Number(a.confidence) || 0);
    if (c !== 0) return c;
    return String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''));
  })[0];
}

export type SharedHoleInput = {
  hole: number;
  par?: number | null;
  yardage?: number | null;
  tee_lat?: number | null;
  tee_lng?: number | null;
  green_lat?: number | null;
  green_lng?: number | null;
  green_front_lat?: number | null;
  green_front_lng?: number | null;
  green_back_lat?: number | null;
  green_back_lng?: number | null;
  source?: string;
  confidence?: number;
};

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const isLat = (v: number | null): v is number => v != null && v >= -90 && v <= 90;
const isLng = (v: number | null): v is number => v != null && v >= -180 && v <= 180;

/** A hole is worth storing only if it has at least a usable tee OR green center point. */
function hasUsableCoords(h: SharedHoleInput): boolean {
  return (isLat(num(h.tee_lat)) && isLng(num(h.tee_lng))) || (isLat(num(h.green_lat)) && isLng(num(h.green_lng)));
}

/**
 * Record one contributor's holes: upsert each into the reports table, then recompute the
 * canonical row for every touched hole. Best-effort — logs and continues on per-row errors,
 * never throws. Returns the count of holes written.
 */
export async function recordContribution(
  db: Db,
  courseId: string,
  contributorHash: string,
  holes: SharedHoleInput[],
): Promise<number> {
  let written = 0;
  const touched: number[] = [];
  for (const h of holes) {
    const hole = Math.trunc(Number(h.hole));
    if (!Number.isFinite(hole) || hole < 1 || hole > 36) continue;
    if (!hasUsableCoords(h)) continue;
    // SECURITY: never trust the client's claimed source/confidence. The public share endpoint only
    // ever receives client-derived (AI-vision) observations, so we FORCE source='ai_vision' (the
    // lowest rank) — otherwise an attacker could POST source:'bundled' (rank 4) to outrank and
    // overwrite legitimate geometry for every player. Confidence is capped so a single caller can't
    // claim certainty; corroboration across contributors (contributor_count) is what earns trust.
    const source = 'ai_vision';
    const confidence = Math.min(0.7, Math.max(0, num(h.confidence) ?? 0.5));
    const row = {
      course_id: courseId,
      hole,
      contributor_hash: contributorHash,
      tee_lat: num(h.tee_lat), tee_lng: num(h.tee_lng),
      green_lat: num(h.green_lat), green_lng: num(h.green_lng),
      green_front_lat: num(h.green_front_lat), green_front_lng: num(h.green_front_lng),
      green_back_lat: num(h.green_back_lat), green_back_lng: num(h.green_back_lng),
      source,
      confidence,
    };
    const { error } = await db.from(REPORTS).upsert(row, { onConflict: 'course_id,hole,contributor_hash' });
    if (error) { console.warn('[courseCloud] report upsert failed', courseId, hole, error.message); continue; }
    written++;
    touched.push(hole);
    await recomputeCanonical(db, courseId, hole, { par: num(h.par), yardage: num(h.yardage) });
  }
  console.log('[courseCloud] recorded', written, 'holes for', courseId, '— holes:', touched.join(','));
  return written;
}

/** Recompute the merged canonical row for one hole from all its reports. */
async function recomputeCanonical(
  db: Db,
  courseId: string,
  hole: number,
  meta: { par: number | null; yardage: number | null },
): Promise<void> {
  const { data, error } = await db
    .from(REPORTS)
    .select('*')
    .eq('course_id', courseId)
    .eq('hole', hole);
  if (error || !Array.isArray(data) || data.length === 0) return;

  // Best report wins: source rank, then confidence, then recency.
  const best = chooseBestReport(data);
  if (!best) return;

  const canon = {
    course_id: courseId,
    hole,
    par: meta.par ?? undefined,
    yardage: meta.yardage ?? undefined,
    tee_lat: best.tee_lat, tee_lng: best.tee_lng,
    green_lat: best.green_lat, green_lng: best.green_lng,
    green_front_lat: best.green_front_lat, green_front_lng: best.green_front_lng,
    green_back_lat: best.green_back_lat, green_back_lng: best.green_back_lng,
    source: best.source,
    confidence: best.confidence,
    contributor_count: new Set(data.map(r => String(r.contributor_hash))).size,
    updated_at: new Date().toISOString(),
  };
  const { error: upErr } = await db.from(CANON).upsert(canon, { onConflict: 'course_id,hole' });
  if (upErr) console.warn('[courseCloud] canonical upsert failed', courseId, hole, upErr.message);
}

/** HoleGeometry-shaped row the client's courseGeometryService consumes. */
export type SharedHoleGeometry = {
  hole_number: number;
  par: number;
  yardage: number;
  tee: { lat: number; lng: number } | null;
  green: { lat: number; lng: number } | null;
  green_front: { lat: number; lng: number } | null;
  green_back: { lat: number; lng: number } | null;
  bearing_deg: number | null;
  hazards: never[];
  fairway_centerline: never[];
  green_outline: never[];
  estimated: boolean;
  estimated_confidence: 'high' | 'medium' | 'low';
  contributor_count: number;
};

const pt = (lat: unknown, lng: unknown): { lat: number; lng: number } | null => {
  const la = num(lat), ln = num(lng);
  return isLat(la) && isLng(ln) ? { lat: la, lng: ln } : null;
};
const confBucket = bucketConfidence;

/**
 * Read the merged canonical geometry for a course. Returns null when the community DB has
 * nothing for it (caller falls back to the golfcourseapi/OSM proxy). Never throws.
 */
export async function readSharedGeometry(db: Db, courseId: string): Promise<SharedHoleGeometry[] | null> {
  const { data, error } = await db.from(CANON).select('*').eq('course_id', courseId).order('hole');
  if (error) { console.warn('[courseCloud] read failed', courseId, error.message); return null; }
  if (!Array.isArray(data) || data.length === 0) return null;
  const holes = data
    .map((r): SharedHoleGeometry | null => {
      const tee = pt(r.tee_lat, r.tee_lng);
      const green = pt(r.green_lat, r.green_lng);
      if (!tee && !green) return null;
      const conf = Number(r.confidence) || 0;
      // A curated/on-foot source is authoritative; only AI-vision reads are flagged ESTIMATED.
      const estimated = String(r.source) === 'ai_vision';
      return {
        hole_number: Number(r.hole),
        par: Number(r.par) || 0,
        yardage: Number(r.yardage) || 0,
        tee,
        green,
        green_front: pt(r.green_front_lat, r.green_front_lng),
        green_back: pt(r.green_back_lat, r.green_back_lng),
        bearing_deg: null,
        hazards: [],
        fairway_centerline: [],
        green_outline: [],
        estimated,
        estimated_confidence: confBucket(conf),
        contributor_count: Number(r.contributor_count) || 1,
      };
    })
    .filter((h): h is SharedHoleGeometry => h != null);
  return holes.length > 0 ? holes : null;
}
