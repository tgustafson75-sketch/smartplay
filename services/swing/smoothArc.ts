/**
 * 2026-07-18 (Tim — "swing tracing needs to fucking work: a smooth arc that FOLLOWS the clubhead,
 * not a glitchy bouncing line; once you locate it, follow a smooth line and AVERAGE it out").
 *
 * The clubhead detector (api/club-path via Haiku vision) returns an HONEST but NOISY per-frame
 * position: it occasionally grabs the hands, the shaft, or a background object instead of the
 * head, which shows up as a spike that juts off the arc and back. Drawing a spline straight
 * through those raw points (and with UNIFORM Catmull-Rom, which overshoots on unevenly-spaced
 * points) is what made the trace look glitchy.
 *
 * This module is a PURE, deterministic cleanup applied at render time (the raw detections stay
 * untouched for the "seen in N of M" honesty count):
 *   1. rejectSpikes()  — remove points that detour far off the time-ordered path (bad detections).
 *   2. movingAverage()  — average out residual jitter without cutting the arc's real curvature.
 *   3. catmullRomBezier() — CENTRIPETAL Catmull-Rom → smooth, no overshoot/loops/cusps.
 *
 * No fabrication: we only reject and average REAL detected points; we never invent a position to
 * complete the arc (gaps stay gaps). A golf clubhead sweeps a continuous smooth path, so averaging
 * measured points is a faithful read of that path, not a made-up one.
 */

export interface ArcPoint { x: number; y: number; t: number }

const dist = (a: ArcPoint, b: ArcPoint): number => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Total path length of the time-ordered points — used to scale thresholds so they work in any
 * coordinate space (normalized 0..1 or pixel).
 */
function pathLength(pts: ArcPoint[]): number {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]);
  return L;
}

/**
 * Remove spike outliers: an interior point p is a spike when the detour through it
 * (|prev→p| + |p→next|) is much longer than going directly (|prev→next|) AND it sits far off that
 * direct segment. A clubhead moves along a continuous arc and cannot teleport off it and back, so
 * such a point is a mis-detection. Iterates until stable (handles a couple of adjacent spikes).
 */
export function rejectSpikes(pts: ArcPoint[], opts?: { detourRatio?: number; offFrac?: number }): ArcPoint[] {
  const detourRatio = opts?.detourRatio ?? 1.7;   // detour vs direct must exceed this
  const offFrac = opts?.offFrac ?? 0.10;          // AND perpendicular offset > this frac of path length
  if (pts.length < 3) return pts.slice();
  let cur = pts.slice();
  for (let pass = 0; pass < 3; pass++) {
    const L = pathLength(cur) || 1;
    const offThresh = L * offFrac;
    const keep: ArcPoint[] = [cur[0]];
    let removed = false;
    for (let i = 1; i < cur.length - 1; i++) {
      const prev = keep[keep.length - 1];
      const p = cur[i];
      const next = cur[i + 1];
      const direct = dist(prev, next);
      const detour = dist(prev, p) + dist(p, next);
      // Perpendicular distance of p from the prev→next segment.
      const off = perpDistance(p, prev, next);
      const isSpike = direct > 1e-6 && detour > direct * detourRatio && off > offThresh;
      if (isSpike) { removed = true; continue; } // drop p
      keep.push(p);
    }
    keep.push(cur[cur.length - 1]);
    cur = keep;
    if (!removed) break;
  }
  return cur;
}

/** Perpendicular distance from point p to the segment a→b (falls back to |p-a| for a degenerate seg). */
function perpDistance(p: ArcPoint, a: ArcPoint, b: ArcPoint): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-9) return dist(p, a);
  const tRaw = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  const tt = Math.max(0, Math.min(1, tRaw));
  const cx = a.x + tt * dx, cy = a.y + tt * dy;
  return Math.hypot(p.x - cx, p.y - cy);
}

/**
 * Weighted moving average ([0.25, 0.5, 0.25]) over interior points — averages out residual
 * detection jitter while keeping the endpoints anchored and preserving the arc's real curves.
 * `passes` applies it repeatedly for a smoother line (2 is a good default for ~12-14 points).
 */
export function movingAverage(pts: ArcPoint[], passes = 2): ArcPoint[] {
  if (pts.length < 3) return pts.slice();
  let cur = pts.slice();
  for (let pass = 0; pass < passes; pass++) {
    const out: ArcPoint[] = [cur[0]];
    for (let i = 1; i < cur.length - 1; i++) {
      const a = cur[i - 1], b = cur[i], c = cur[i + 1];
      out.push({ x: a.x * 0.25 + b.x * 0.5 + c.x * 0.25, y: a.y * 0.25 + b.y * 0.5 + c.y * 0.25, t: b.t });
    }
    out.push(cur[cur.length - 1]);
    cur = out;
  }
  return cur;
}

/** Full cleanup: drop spikes, then average. Returns finite points only. */
export function cleanArc(pts: ArcPoint[]): ArcPoint[] {
  const finite = pts.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.t));
  if (finite.length < 3) return finite;
  return movingAverage(rejectSpikes(finite), 2);
}

/**
 * CENTRIPETAL Catmull-Rom (alpha = 0.5) control points for the cubic-Bezier segment p1→p2.
 * Centripetal parameterization prevents the overshoot, cusps, and self-intersections that plague
 * UNIFORM Catmull-Rom on unevenly-spaced points — the specific cause of the "glitchy loop" look.
 * p0 and p3 are the neighbors (pass p1 for p0 at the start, p2 for p3 at the end).
 */
export function catmullRomBezier(
  p0: ArcPoint, p1: ArcPoint, p2: ArcPoint, p3: ArcPoint,
): { cp1x: number; cp1y: number; cp2x: number; cp2y: number } {
  const alpha = 0.5;
  const t = (a: ArcPoint, b: ArcPoint): number => Math.pow(Math.max(1e-6, dist(a, b)), alpha);
  const t01 = t(p0, p1), t12 = t(p1, p2), t23 = t(p2, p3);

  // Tangents (Barry–Goldman), scaled to the p1→p2 segment.
  const m1x = (p2.x - p1.x + t12 * ((p1.x - p0.x) / t01 - (p2.x - p0.x) / (t01 + t12)));
  const m1y = (p2.y - p1.y + t12 * ((p1.y - p0.y) / t01 - (p2.y - p0.y) / (t01 + t12)));
  const m2x = (p2.x - p1.x + t12 * ((p3.x - p2.x) / t23 - (p3.x - p1.x) / (t12 + t23)));
  const m2y = (p2.y - p1.y + t12 * ((p3.y - p2.y) / t23 - (p3.y - p1.y) / (t12 + t23)));

  const cp1x = p1.x + m1x / 3;
  const cp1y = p1.y + m1y / 3;
  const cp2x = p2.x - m2x / 3;
  const cp2y = p2.y - m2y / 3;
  // Guard: any non-finite tangent (coincident points) collapses to a straight segment.
  if (![cp1x, cp1y, cp2x, cp2y].every(Number.isFinite)) {
    return { cp1x: p1.x, cp1y: p1.y, cp2x: p2.x, cp2y: p2.y };
  }
  return { cp1x, cp1y, cp2x, cp2y };
}
