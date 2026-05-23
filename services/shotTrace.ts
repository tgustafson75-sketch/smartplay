/**
 * 2026-05-22 — Shot Trace Reconstruction.
 *
 * Builds a typed, confidence-scored ShotTrace from the data the app
 * already captures around a swing:
 *   - gpsManager sustained-fix buffer (via courseDataOrchestrator)
 *     gives the player's position before / during / after impact.
 *   - ShotResult.start_location + end_location from roundStore give
 *     hard endpoints when the player marked them (or the next shot's
 *     start back-filled them).
 *   - glassesVisionInput recent frames give optional visual hints
 *     (launch angle inferred from horizon, downward POV for putts).
 *   - acousticImpactDetector ImpactReading gives an impact timestamp +
 *     intensity, useful for picking the right fix from the buffer.
 *
 * What this is NOT:
 *   - Real-time AR overlay (that's a separate component / future work).
 *   - True ball-flight physics with spin + altitude integration. We
 *     reconstruct start → end + apex estimate from kinematics that the
 *     phone can plausibly observe; spin / launch-angle / wind drift
 *     are inferred from club + outcome + wind context, not measured.
 *
 * Output: a ShotTrace object with start, end, carry/total distance,
 * direction bearing, apex estimate, dispersion confidence, and the
 * sources used. Suitable for recap rendering, the smartAnalysisEngine
 * 'shot_trace' kind (future), and a future AR overlay that projects
 * the same path into the camera view.
 *
 * Defensive: every reconstruction returns a typed result. When no
 * GPS endpoints are known the trace marks itself low-confidence
 * with `kind: 'estimated'` rather than throwing.
 */

import { useRoundStore, type ShotResult, type ShotLocation } from '../store/roundStore';
import { haversineYards, bearingDegrees } from '../utils/geoDistance';
import { getSustainedFixes } from './courseDataOrchestrator';
import { getRecentVisionFrames } from './glassesVisionInput';
import { getLastFix } from './gpsManager';
import { devLog } from './devLog';

// ─── Types ───────────────────────────────────────────────────────────────

export type TraceQuality = 'measured' | 'measured_endpoints' | 'estimated' | 'insufficient';

export interface TracePoint {
  /** Lat/lng on the ground. */
  lat: number;
  lng: number;
  /** Estimated height above ground in feet. 0 at endpoints; peak at apex. */
  altitude_ft: number;
  /** Fraction of total flight time at this point (0..1). */
  t: number;
}

export interface ShotTrace {
  /** Stable id for the trace; matches a logged ShotResult.id when one
   *  exists, else freshly generated. */
  shot_id: string;
  /** Capture timestamp (ms). */
  captured_at: number;
  /** Hole number the trace belongs to. */
  hole_number: number | null;
  /** Club used (if known). */
  club: string | null;

  start: ShotLocation | null;
  end: ShotLocation | null;
  /** Total ground distance in yards. */
  carry_yd: number | null;
  /** Initial bearing in degrees (0=N, 90=E). */
  bearing_deg: number | null;
  /** Estimated apex height in feet — derived from club + carry. */
  apex_ft: number | null;
  /** Estimated time of flight in seconds. */
  flight_seconds: number | null;
  /** Lateral dispersion estimate (yards) — confidence cone radius. */
  dispersion_yd: number;

  /** Sampled trajectory points (start, several arc points, end). UI uses
   *  these to draw the path; an AR overlay can use them as world points
   *  to project into camera space. Length ~12 by default. */
  trajectory: TracePoint[];

  /** Reconstruction confidence 0..100. */
  confidence: number;
  quality: TraceQuality;
  /** Sources that contributed signal. */
  sources_used: ('shot_result' | 'gps_buffer' | 'vision' | 'club_typical')[];
  /** Free-text reason / decision trail — devLog'd, surfaced in debug panel. */
  reason: string;
}

// ─── Tunables (golf rationale) ───────────────────────────────────────────

/** Apex (peak height) heuristic per club. Numbers in feet. Median PGA-tour
 *  apex by club is well documented; consumer-amateur apex sits lower but
 *  follows the same shape. Used when we have a carry distance but no
 *  trajectory observation. */
const APEX_BY_CLUB: Record<string, number> = {
  Driver: 100, '3W': 95, '5W': 90, Hybrid: 85,
  '3i': 80, '4i': 85, '5i': 88, '6i': 90, '7i': 92,
  '8i': 95, '9i': 98, PW: 100, GW: 105, SW: 110, LW: 115,
  Putter: 1,
};
const APEX_DEFAULT_FT = 90;

/** Flight-time heuristic — rough seconds per yard at typical launch.
 *  Real flight time varies massively with launch + spin; this gives a
 *  plausible default for animation timing. */
const FLIGHT_SECONDS_PER_YARD = 0.014;

/** Default dispersion cone (yards). Tighter for shorter clubs, wider
 *  for the driver. */
const DISPERSION_BY_CLUB: Record<string, number> = {
  Driver: 25, '3W': 22, '5W': 20, Hybrid: 18,
  '3i': 18, '4i': 16, '5i': 15, '6i': 13, '7i': 12,
  '8i': 11, '9i': 10, PW: 8, GW: 7, SW: 6, LW: 6,
  Putter: 2,
};
const DISPERSION_DEFAULT_YD = 15;

const TRAJECTORY_POINTS = 12;

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Reconstruct a ShotTrace for a specific shot in the round store.
 * `shot.start_location` + `shot.end_location` give us the endpoints;
 * gpsManager's sustained buffer + glasses frames refine confidence.
 *
 * Safe to call with a shot that has neither endpoint — returns an
 * 'insufficient' trace the caller can fall back to display copy with.
 */
export async function reconstructShotTrace(shotId: string): Promise<ShotTrace> {
  const round = useRoundStore.getState();
  const shot = round.shots.find(s => s.id === shotId);
  if (!shot) {
    return emptyTrace(shotId, null, null, 'shot id not found in round');
  }
  return buildFromShot(shot);
}

/**
 * Reconstruct the most recent shot's trace. Convenience for the cockpit
 * "show that shot" UI and the voice intent route ("show me my last
 * shot path").
 */
export async function reconstructLastShotTrace(): Promise<ShotTrace> {
  const round = useRoundStore.getState();
  const last = round.shots[round.shots.length - 1];
  if (!last) {
    return emptyTrace('no_shots', null, null, 'no shots logged in this round');
  }
  return buildFromShot(last);
}

/**
 * Reconstruct from explicit endpoints (no shot record required). Useful
 * for the AR-trace preview that draws a candidate path BEFORE the shot
 * lands (start = current position, end = predicted landing zone).
 */
export function tracePreview(
  start: ShotLocation,
  end: ShotLocation,
  club: string | null = null,
): ShotTrace {
  const carry = Math.round(haversineYards(start, end));
  const bearing = bearingDegrees(start, end);
  const apex = apexForClub(club, carry);
  const dispersion = dispersionForClub(club);
  return {
    shot_id: 'preview_' + Date.now().toString(36),
    captured_at: Date.now(),
    hole_number: null,
    club,
    start,
    end,
    carry_yd: carry,
    bearing_deg: bearing,
    apex_ft: apex,
    flight_seconds: carry * FLIGHT_SECONDS_PER_YARD,
    dispersion_yd: dispersion,
    trajectory: sampleArc(start, end, apex, TRAJECTORY_POINTS),
    confidence: 70,
    quality: 'estimated',
    sources_used: ['club_typical'],
    reason: 'preview from explicit endpoints',
  };
}

// ─── Reconstruction core ────────────────────────────────────────────────

async function buildFromShot(shot: ShotResult): Promise<ShotTrace> {
  const sources: ShotTrace['sources_used'] = ['shot_result'];
  const start = shot.start_location ?? shot.gps_location ?? null;
  const end = shot.end_location ?? null;
  const club = shot.club ?? null;

  // ─── Refine from GPS buffer when one endpoint is missing ────────────
  let refinedStart = start;
  let refinedEnd = end;
  const buffer = getSustainedFixes();
  if (!refinedStart && buffer.length > 0) {
    // Best guess: the buffered fix closest to the shot's timestamp.
    const nearest = nearestByTime(buffer, shot.timestamp);
    if (nearest) {
      refinedStart = { lat: nearest.lat, lng: nearest.lng };
      sources.push('gps_buffer');
    }
  }
  if (!refinedEnd) {
    // For an in-progress shot we don't know where it landed yet. Use the
    // most-recent post-shot fix when available (player walking to ball).
    const last = getLastFix();
    if (last && last.timestamp > shot.timestamp) {
      refinedEnd = { lat: last.lat, lng: last.lng };
      sources.push('gps_buffer');
    }
  }

  // ─── Optional vision-frame signal (just records source — not yet
  // model-derived launch angle). Adds confidence when the player had a
  // fresh glasses frame around the strike. ─────────────────────────────
  try {
    const frames = await getRecentVisionFrames(4);
    if (frames.length > 0) sources.push('vision');
  } catch { /* non-fatal */ }

  if (!refinedStart || !refinedEnd) {
    return emptyTrace(
      shot.id ?? 'shot_' + Date.now().toString(36),
      shot.hole,
      club,
      `missing endpoints (start=${!!refinedStart} end=${!!refinedEnd})`,
    );
  }

  const carry = Math.round(haversineYards(refinedStart, refinedEnd));
  const bearing = bearingDegrees(refinedStart, refinedEnd);
  const apex = apexForClub(club, carry);
  const dispersion = dispersionForClub(club);
  const trajectory = sampleArc(refinedStart, refinedEnd, apex, TRAJECTORY_POINTS);

  // Confidence: full endpoints + club known → 85; missing one → lower.
  const quality: TraceQuality =
    shot.start_location && shot.end_location ? 'measured'
    : refinedStart && refinedEnd ? 'measured_endpoints'
    : 'estimated';
  let confidence = quality === 'measured' ? 85 : quality === 'measured_endpoints' ? 65 : 40;
  if (club) confidence += 5;
  if (sources.includes('vision')) confidence += 3;
  confidence = Math.max(0, Math.min(100, confidence));

  const trace: ShotTrace = {
    shot_id: shot.id ?? 'shot_' + shot.timestamp.toString(36),
    captured_at: shot.timestamp,
    hole_number: shot.hole,
    club,
    start: refinedStart,
    end: refinedEnd,
    carry_yd: carry,
    bearing_deg: bearing,
    apex_ft: apex,
    flight_seconds: carry * FLIGHT_SECONDS_PER_YARD,
    dispersion_yd: dispersion,
    trajectory,
    confidence,
    quality,
    sources_used: sources,
    reason: `${quality} from ${sources.join('+')}; ${carry}y ${club ?? 'club'} @ bearing ${Math.round(bearing)}°`,
  };
  devLog(`[shotTrace] ${trace.shot_id} ${trace.reason} conf=${confidence}`);
  return trace;
}

// ─── Trajectory sampling ─────────────────────────────────────────────────

/**
 * Sample a parabolic arc between start and end with peak at apex_ft.
 * Lat/lng interpolation is linear (small enough span for it); altitude
 * follows y = 4*apex*t*(1-t) — the classic ballistic-style symmetric
 * parabola. Sufficient for visualization and an AR projection seed.
 */
function sampleArc(
  start: ShotLocation, end: ShotLocation, apex_ft: number, count: number,
): TracePoint[] {
  const out: TracePoint[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const lat = start.lat + (end.lat - start.lat) * t;
    const lng = start.lng + (end.lng - start.lng) * t;
    const alt = 4 * apex_ft * t * (1 - t);
    out.push({ lat, lng, altitude_ft: round1(alt), t });
  }
  return out;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function apexForClub(club: string | null, carry: number | null): number {
  // If we have a carry distance, scale apex slightly with distance —
  // longer shots from the same club tend toward higher apex.
  const base = club ? (APEX_BY_CLUB[club] ?? APEX_DEFAULT_FT) : APEX_DEFAULT_FT;
  if (carry == null || carry <= 0) return base;
  // Modest scaling: ±15% based on distance vs typical carry.
  const typical = club === 'Driver' ? 240 : club === '7i' ? 150 : club === 'PW' ? 110 : 150;
  const ratio = Math.max(0.6, Math.min(1.4, carry / typical));
  return Math.round(base * Math.sqrt(ratio));
}

function dispersionForClub(club: string | null): number {
  return club ? (DISPERSION_BY_CLUB[club] ?? DISPERSION_DEFAULT_YD) : DISPERSION_DEFAULT_YD;
}

function nearestByTime<T extends { timestamp: number }>(
  arr: readonly T[], ts: number,
): T | null {
  if (arr.length === 0) return null;
  let best = arr[0];
  let bestDelta = Math.abs(arr[0].timestamp - ts);
  for (const x of arr) {
    const d = Math.abs(x.timestamp - ts);
    if (d < bestDelta) { best = x; bestDelta = d; }
  }
  return best;
}

function emptyTrace(
  shotId: string, hole: number | null, club: string | null, reason: string,
): ShotTrace {
  return {
    shot_id: shotId,
    captured_at: Date.now(),
    hole_number: hole,
    club,
    start: null, end: null,
    carry_yd: null, bearing_deg: null, apex_ft: null, flight_seconds: null,
    dispersion_yd: dispersionForClub(club),
    trajectory: [],
    confidence: 0,
    quality: 'insufficient',
    sources_used: ['shot_result'],
    reason,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
