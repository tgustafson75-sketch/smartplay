/**
 * 2026-06-11 — "Smart freehand" geometry fitting for the Smart Motion /
 * Coach Mode annotation overlay.
 *
 * Tim's directive: the freehand tool should be TRULY smart. If the user
 * draws a crooked-but-roughly-straight line (a swing plane / alignment
 * line), AI straightens it — keeping the orientation and extent the user
 * intended. If the user draws a sloppy circle around a hip or shoulder, it
 * snaps to a clean circle. The fiddly two-point ROI/line tools become
 * unnecessary: you just draw, and it cleans up.
 *
 * Design principles:
 *   - PURE functions, no React / no side effects → unit-testable + sim-able.
 *   - CONSERVATIVE classification. A stroke is only "straightened" or
 *     "snapped" when the fit is clearly good. A genuine freehand scribble,
 *     an arrow, or a gentle curve does NOT fit a line or circle well, so it
 *     stays freehand. We never destroy intent we're unsure about.
 *   - Orientation/extent preserved: the fitted line's endpoints are the
 *     user's own stroke extremes projected onto the best-fit axis, so a line
 *     drawn bottom-left→top-right stays bottom-left→top-right at the same
 *     length — just straight.
 *
 * Coordinate space: screen px of the annotation overlay (same space the
 * overlay's Shapes already live in). No transform needed.
 */

export interface Pt { x: number; y: number }

export type StrokeClass =
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number }
  | { kind: 'circle'; cx: number; cy: number; r: number }
  | { kind: 'freehand' };

/**
 * Parse an SVG path d-string of the form "M x y L x y L x y ..." (exactly
 * what the overlay's freehand PanResponder produces) into a point array.
 * Tolerant of extra whitespace and comma separators; ignores any command
 * letter and just reads the numeric pairs in order.
 */
export function parsePathPoints(d: string): Pt[] {
  if (!d) return [];
  const nums = d.match(/-?\d+(?:\.\d+)?/g);
  if (!nums) return [];
  const pts: Pt[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    const x = parseFloat(nums[i]);
    const y = parseFloat(nums[i + 1]);
    if (Number.isFinite(x) && Number.isFinite(y)) pts.push({ x, y });
  }
  return pts;
}

/** Drop near-duplicate consecutive points (finger jitter) so fits aren't
 *  biased by clusters where the finger paused. */
function dedupe(pts: Pt[], minStep = 1.5): Pt[] {
  if (pts.length === 0) return pts;
  const out: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    const q = out[out.length - 1];
    if (Math.hypot(p.x - q.x, p.y - q.y) >= minStep) out.push(p);
  }
  return out;
}

export interface LineFit {
  x1: number; y1: number; x2: number; y2: number;
  /** RMS perpendicular distance to the fit line, normalized by segment
   *  length. 0 = perfectly straight. ~0.05 = slightly wobbly. */
  residual: number;
  length: number;
}

/**
 * Total-least-squares (PCA) line fit — handles vertical lines correctly,
 * unlike a y=mx+b regression. Endpoints are the stroke's extremes projected
 * onto the principal axis, so the user's direction + length are preserved.
 */
export function fitLine(input: Pt[]): LineFit | null {
  const pts = dedupe(input);
  const n = pts.length;
  if (n < 3) return null;

  let mx = 0, my = 0;
  for (const p of pts) { mx += p.x; my += p.y; }
  mx /= n; my /= n;

  let Sxx = 0, Sxy = 0, Syy = 0;
  for (const p of pts) {
    const dx = p.x - mx, dy = p.y - my;
    Sxx += dx * dx; Sxy += dx * dy; Syy += dy * dy;
  }

  // Principal axis angle of the covariance matrix.
  const theta = 0.5 * Math.atan2(2 * Sxy, Sxx - Syy);
  const c = Math.cos(theta), s = Math.sin(theta);

  let tMin = Infinity, tMax = -Infinity, sumPerpSq = 0;
  for (const p of pts) {
    const dx = p.x - mx, dy = p.y - my;
    const t = dx * c + dy * s;          // along-axis coord
    const perp = -dx * s + dy * c;      // perpendicular distance
    sumPerpSq += perp * perp;
    if (t < tMin) tMin = t;
    if (t > tMax) tMax = t;
  }

  const length = tMax - tMin;
  if (length < 1) return null;
  const rms = Math.sqrt(sumPerpSq / n);
  return {
    x1: mx + tMin * c, y1: my + tMin * s,
    x2: mx + tMax * c, y2: my + tMax * s,
    residual: rms / length,
    length,
  };
}

export interface CircleFit {
  cx: number; cy: number; r: number;
  /** RMS radial error normalized by radius. 0 = perfect circle. */
  residual: number;
  /** Fraction of a full turn the stroke swept (sum of per-step angle deltas
   *  about the center, /2π, capped at 1). ~1 = a closed loop. */
  closure: number;
}

/**
 * Algebraic (Kåsa) circle fit: solve x²+y² + D·x + E·y + F = 0 by least
 * squares via the 3×3 normal equations (Cramer's rule). Cheap and stable
 * for the smooth, well-sampled strokes a finger produces.
 */
export function fitCircle(input: Pt[]): CircleFit | null {
  const pts = dedupe(input);
  const n = pts.length;
  if (n < 5) return null;

  let Sx = 0, Sy = 0, Sxx = 0, Syy = 0, Sxy = 0, Sxz = 0, Syz = 0, Sz = 0;
  for (const p of pts) {
    const x = p.x, y = p.y, z = x * x + y * y;
    Sx += x; Sy += y; Sxx += x * x; Syy += y * y; Sxy += x * y;
    Sxz += x * z; Syz += y * z; Sz += z;
  }

  // Normal equations  M · [D,E,F]ᵀ = b,  with b = [-Sxz, -Syz, -Sz].
  const M = [
    [Sxx, Sxy, Sx],
    [Sxy, Syy, Sy],
    [Sx,  Sy,  n],
  ];
  const b = [-Sxz, -Syz, -Sz];
  const det = det3(M);
  if (Math.abs(det) < 1e-6) return null;

  const D = det3(replaceCol(M, b, 0)) / det;
  const E = det3(replaceCol(M, b, 1)) / det;
  const F = det3(replaceCol(M, b, 2)) / det;

  const cx = -D / 2, cy = -E / 2;
  const r2 = cx * cx + cy * cy - F;
  if (r2 <= 0) return null;
  const r = Math.sqrt(r2);

  // Radial residual + angular sweep (closure).
  let sumErrSq = 0, sweep = 0;
  let prevAng = Math.atan2(pts[0].y - cy, pts[0].x - cx);
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const d = Math.hypot(p.x - cx, p.y - cy);
    sumErrSq += (d - r) * (d - r);
    if (i > 0) {
      const ang = Math.atan2(p.y - cy, p.x - cx);
      let delta = ang - prevAng;
      while (delta > Math.PI) delta -= 2 * Math.PI;
      while (delta < -Math.PI) delta += 2 * Math.PI;
      sweep += Math.abs(delta);
      prevAng = ang;
    }
  }
  const rms = Math.sqrt(sumErrSq / n);
  return {
    cx, cy, r,
    residual: rms / r,
    closure: Math.min(1, sweep / (2 * Math.PI)),
  };
}

// ── Classification thresholds (tuned for finger-drawn strokes; conservative
//    so genuine scribbles/curves stay freehand). Exported for sim visibility.
export const LINE_RESIDUAL_MAX = 0.07;   // ≤7% wobble vs length → straight.
// 0.07 straightens finger-wobble lines (typically 0.02–0.06) but leaves a
// genuine curve alone — e.g. a 120° traced arc sits ~0.086 and stays freehand,
// so someone tracing a swing path doesn't get it flattened.
export const LINE_MIN_LENGTH   = 18;     // px; shorter = a tick, keep freehand
export const CIRCLE_RESIDUAL_MAX = 0.18; // ≤18% radial wobble → circle
export const CIRCLE_MIN_CLOSURE  = 0.62; // swept ≥62% of a turn → a loop
export const CIRCLE_MIN_RADIUS   = 8;    // px

/**
 * Decide what the user most likely drew. Closed loops are checked first (a
 * high angular sweep is a strong "this is a circle" signal a line can never
 * trip). Falls back to freehand whenever neither shape fits cleanly — we
 * only ever replace a stroke we're confident about.
 */
export function classifyStroke(d: string): StrokeClass {
  const pts = parsePathPoints(d);
  if (pts.length < 6) return { kind: 'freehand' };

  const circle = fitCircle(pts);
  if (
    circle &&
    circle.closure >= CIRCLE_MIN_CLOSURE &&
    circle.residual <= CIRCLE_RESIDUAL_MAX &&
    circle.r >= CIRCLE_MIN_RADIUS
  ) {
    return { kind: 'circle', cx: circle.cx, cy: circle.cy, r: circle.r };
  }

  const line = fitLine(pts);
  if (
    line &&
    line.residual <= LINE_RESIDUAL_MAX &&
    line.length >= LINE_MIN_LENGTH
  ) {
    return { kind: 'line', x1: line.x1, y1: line.y1, x2: line.x2, y2: line.y2 };
  }

  return { kind: 'freehand' };
}

// ── tiny 3×3 linear-algebra helpers ──
function det3(m: number[][]): number {
  return (
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  );
}
function replaceCol(m: number[][], col: number[], idx: number): number[][] {
  return m.map((row, i) => row.map((v, j) => (j === idx ? col[i] : v)));
}
