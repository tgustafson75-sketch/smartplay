/**
 * 2026-06-11 — Ball-trace direction + colour (the honest DTL shot tracer).
 *
 * NOT a fabricated physics arc (no spin / curve / launch angle — those stay banned,
 * see memory smartmotion-metrics-honesty). This is the REAL initial DEPARTURE
 * direction: the ball is detected a few frames after impact (off the acoustic anchor,
 * via api/ball-departure), and we draw the straight line it left ON, measured RELATIVE
 * to where the player AIMED (the ball→target line) — "I can see from the first few feet
 * it went left, and it went left." Direction is the deliverable; nothing beyond it is
 * claimed. Colour green→red by how far OFF the aim line it started (Tim: "green for a
 * good one, red if it goes way hooked"), optionally dimmed by a weak strike (peakDb).
 *
 * Pure + deterministic so it unit-tests; the CV reliability behind departurePoint is
 * what gets tuned on real 60fps cage footage. DTL-ONLY — callers must gate on
 * angle === 'down_the_line' && !puttMode (no flight to see face-on or in a putt).
 */

export type TraceSide = 'left' | 'right' | 'straight';

export interface TraceDirection {
  side: TraceSide;
  /** Absolute degrees the departure started OFF the ball→target aim line. */
  divergenceDeg: number;
  /** Normalized endpoints to draw: from the ball, extended along the real
   *  departure direction (a straight initial-direction line, not an arc). */
  from: { x: number; y: number };
  to: { x: number; y: number };
}

const STRAIGHT_DEG = 4;        // within this of the aim line reads as straight
const RED_DEG = 25;            // at/over this divergence the line is full red

/**
 * Direction of the real departure relative to the ball→target aim line.
 * `ballCenter`, `departurePoint`, `target` are all normalized (0..1) full-frame.
 * Returns null when the ball didn't visibly move (no honest direction to claim).
 */
export function computeTraceDirection(
  ballCenter: { x: number; y: number },
  departurePoint: { x: number; y: number },
  target: { x: number; y: number } | null,
  extend = 0.6,
): TraceDirection | null {
  const dvx = departurePoint.x - ballCenter.x;
  const dvy = departurePoint.y - ballCenter.y;
  const dLen = Math.hypot(dvx, dvy);
  if (dLen < 0.012) return null; // ball didn't visibly leave — don't draw a guess

  // Aim vector: ball→target, or straight up the frame when no target is set.
  const avx = target ? target.x - ballCenter.x : 0;
  const avy = target ? target.y - ballCenter.y : -1;
  // Angle measured with +x = right, up-the-frame = forward (so atan2(x, -y)). Guard the
  // degenerate case where the target sits essentially ON the ball (zero-length aim
  // vector): atan2(0, -0) returns π and would flip the aim 180° down-frame. Fall back to
  // straight-up (angle 0) so every shot doesn't read ~180° off. (2026-06-12)
  const aimAng = Math.hypot(avx, avy) < 1e-4 ? 0 : Math.atan2(avx, -avy);
  const depAng = Math.atan2(dvx, -dvy);
  let rel = ((depAng - aimAng) * 180) / Math.PI;
  while (rel > 180) rel -= 360;
  while (rel < -180) rel += 360;

  const side: TraceSide = Math.abs(rel) <= STRAIGHT_DEG ? 'straight' : rel > 0 ? 'right' : 'left';
  const ux = dvx / dLen;
  const uy = dvy / dLen;
  return {
    side,
    divergenceDeg: Math.round(Math.abs(rel)),
    from: { x: ballCenter.x, y: ballCenter.y },
    to: { x: ballCenter.x + ux * extend, y: ballCenter.y + uy * extend },
  };
}

// ─── Multi-point shot trace (2026-06-25, Shot Tracing) ──────────────────────
//
// buildShotTrace turns the MEASURED ball positions (services/swing/ballPath →
// api/ball-path) into a tiered, honesty-segregated trace:
//   • measured — the SOLID polyline through the real detected positions only.
//   • projected — an OPTIONAL dashed/faded continuation, computed here from the
//     measured launch direction (a straight launch-angle extrapolation). It is
//     NEVER blended with the measured points and is always flagged "projected".
// The renderer draws `measured` solid and `projected` dashed+faded with a legend
// so the two can't be confused (Tim's law). With <2 measured points there's no
// honest path to draw → tier 'none' and the caller shows a no-track note.

export interface ShotTraceBuild {
  /** 'single' = exactly one ball point seen → a flagged low-confidence launch marker. */
  tier: 'full' | 'launch' | 'single' | 'none';
  /** Solid line: the real detected positions, in time order, normalized 0..1.
   *  Length 0 at tier 'none'. */
  measured: { x: number; y: number }[];
  /** Dashed/faded continuation — ONLY a modeled projection, never measured.
   *  null when we don't draw one (full in-frame path, or nothing to project from). */
  projected: { x: number; y: number }[] | null;
  /** How far OFF the aim line the launch started (from the first→last measured
   *  segment), when a target is known. null when not computable. */
  divergenceDeg: number | null;
  side: TraceSide | null;
  /** Honest one-liner for the caption/legend. */
  headline: string;
  /** The flag shown when the trace is partial / projected. null at full tier. */
  note: string | null;
}

const PROJECT_MIN_SEG = 0.02; // launch segment must span this (norm) to project off
const PROJECT_LEN = 0.55;     // how far to extend the dashed projection (norm)
const PROJECT_STEPS = 5;      // dashed projection sample points
// If the LAST measured point is still well inside the frame, the ball stayed in
// view (short game / chip) → it's a full path, no projection needed.
const IN_FRAME_MARGIN = 0.12;

/**
 * Compose a tiered shot trace from measured ball positions + the aim reference.
 * Pure / deterministic / never-throws. `points`, `ballCenter`, `target` are all
 * normalized full-frame (0..1). Honesty:
 *   - <2 points → tier 'none', no line (caller shows the no-track note).
 *   - ball still in frame at the end → tier 'full', solid line only, no projection.
 *   - ball ran off the edge fast → tier 'launch', solid measured launch segment +
 *     a clearly-labelled dashed projection extrapolated along the launch direction.
 * The projection is geometry-only (a straight launch extrapolation) — no spin,
 * curve, carry or dispersion is ever claimed (memory smartmotion-metrics-honesty).
 */
export function buildShotTrace(
  points: { x: number; y: number }[],
  ballCenter: { x: number; y: number } | null,
  target: { x: number; y: number } | null,
): ShotTraceBuild {
  const measured = points.filter(
    (p) => typeof p?.x === 'number' && typeof p?.y === 'number' && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1,
  );
  if (measured.length === 0) {
    return {
      tier: 'none', measured: [], projected: null, divergenceDeg: null, side: null,
      headline: 'No clean read this swing.',
      note: 'Couldn’t track the ball this time — try better light or keep the ball in frame a beat longer.',
    };
  }
  if (measured.length === 1) {
    // 2026-06-29 (Tim — "show the trace even at low confidence") — a SINGLE detected
    // ball point is a real, seen position; draw origin → that point as a flagged
    // low-confidence launch marker instead of suppressing it entirely.
    const p0 = measured[0];
    const origin = ballCenter ?? p0;
    let side1: TraceSide | null = null;
    let div1: number | null = null;
    const dx1 = p0.x - origin.x;
    const dy1 = p0.y - origin.y;
    if (Math.hypot(dx1, dy1) >= 0.012 && target) {
      const avx = target.x - origin.x;
      const avy = target.y - origin.y;
      const aimAng = Math.hypot(avx, avy) < 1e-4 ? 0 : Math.atan2(avx, -avy);
      const depAng = Math.atan2(dx1, -dy1);
      let rel = ((depAng - aimAng) * 180) / Math.PI;
      while (rel > 180) rel -= 360;
      while (rel < -180) rel += 360;
      side1 = Math.abs(rel) <= STRAIGHT_DEG ? 'straight' : rel > 0 ? 'right' : 'left';
      div1 = Math.round(Math.abs(rel));
    }
    return {
      tier: 'single',
      measured: ballCenter ? [ballCenter, p0] : [p0],
      projected: null,
      divergenceDeg: div1, side: side1,
      headline: 'One ball point — low confidence.',
      note: 'Saw the ball once; keep it in frame a beat longer for a fuller trace.',
    };
  }

  const first = ballCenter ?? measured[0];
  const last = measured[measured.length - 1];

  // Launch direction = first detected origin → last detected point. Divergence vs
  // the aim line reuses the same convention as computeTraceDirection.
  let side: TraceSide | null = null;
  let divergenceDeg: number | null = null;
  const dvx = last.x - first.x;
  const dvy = last.y - first.y;
  const dLen = Math.hypot(dvx, dvy);
  if (dLen >= 0.012) {
    const avx = target ? target.x - first.x : 0;
    const avy = target ? target.y - first.y : -1;
    const aimAng = Math.hypot(avx, avy) < 1e-4 ? 0 : Math.atan2(avx, -avy);
    const depAng = Math.atan2(dvx, -dvy);
    let rel = ((depAng - aimAng) * 180) / Math.PI;
    while (rel > 180) rel -= 360;
    while (rel < -180) rel += 360;
    if (target) {
      side = Math.abs(rel) <= STRAIGHT_DEG ? 'straight' : rel > 0 ? 'right' : 'left';
      divergenceDeg = Math.round(Math.abs(rel));
    }
  }

  // Did the ball stay in frame? If the last point is comfortably inside the frame,
  // we saw the whole (short) flight → full path, no projection.
  const inFrame =
    last.x > IN_FRAME_MARGIN && last.x < 1 - IN_FRAME_MARGIN &&
    last.y > IN_FRAME_MARGIN && last.y < 1 - IN_FRAME_MARGIN;

  if (inFrame) {
    return {
      tier: 'full', measured, projected: null, divergenceDeg, side,
      headline: 'Full ball flight tracked.',
      note: null,
    };
  }

  // Ball left the frame fast → measured LAUNCH segment + a dashed projection.
  // Only project when the launch segment is long enough to give a real direction.
  let projected: { x: number; y: number }[] | null = null;
  if (dLen >= PROJECT_MIN_SEG) {
    const ux = dvx / dLen;
    const uy = dvy / dLen;
    const pts: { x: number; y: number }[] = [];
    for (let i = 1; i <= PROJECT_STEPS; i++) {
      const t = (PROJECT_LEN * i) / PROJECT_STEPS;
      pts.push({ x: last.x + ux * t, y: last.y + uy * t });
    }
    projected = pts;
  }

  return {
    tier: 'launch',
    measured,
    projected,
    divergenceDeg,
    side,
    headline: projected
      ? 'Launch tracked — flight projected (the ball left frame).'
      : 'Launch direction tracked (the ball left frame).',
    note: 'Solid = measured launch off the camera; dashed = projected (estimated continuation, not measured).',
  };
}

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * Math.max(0, Math.min(1, t)));
}

/**
 * Green → amber → red by how far off the aim line the ball started. Straight = the
 * neon-green brand (#88F700), a big hook/slice = red (#ef4444). When `peakDb` is supplied and the
 * strike was weak relative to `peakDbRef` (the session's solid-strike energy), the
 * colour is dimmed toward grey — an honest "soft contact" cue. Returns a hex string.
 */
export function traceColor(divergenceDeg: number, peakDb?: number, peakDbRef?: number): string {
  const t = Math.max(0, Math.min(1, (divergenceDeg - STRAIGHT_DEG) / (RED_DEG - STRAIGHT_DEG)));
  // Green (52,211,153) → amber (245,158,11) → red (239,68,68).
  let r: number, g: number, b: number;
  if (t < 0.5) {
    const u = t / 0.5;
    // 2026-06-29 (Tim — "brand everything"): a straight shot traces in the NEON-GREEN
    // brand #88F700 (136,247,0), not emerald — then fades amber → red as it diverges
    // so the miss signal stays meaningful.
    r = lerp(136, 245, u); g = lerp(247, 158, u); b = lerp(0, 11, u);
  } else {
    const u = (t - 0.5) / 0.5;
    r = lerp(245, 239, u); g = lerp(158, 68, u); b = lerp(11, 68, u);
  }
  // Weak-strike dim: fade toward grey when THIS strike is well below the loudest
  // (reference) strike. Use the dB DIFFERENCE from the reference, not a ratio (which
  // inverts). The reference is the LOUDEST strike (max value) — `peakDb - peakDbRef`
  // is ≤ 0 and grows more negative as this strike gets quieter, so the curve is correct
  // whatever the metering SIGN convention (dBFS-negative or headroom-positive). Only
  // applies to real acoustic strikes (non-zero); a video-located 0 keeps full colour.
  if (typeof peakDb === 'number' && typeof peakDbRef === 'number' && peakDb !== 0 && peakDbRef !== 0) {
    const DIM_SPAN_DB = 25;
    const strength = Math.max(0.4, Math.min(1, 1 + (peakDb - peakDbRef) / DIM_SPAN_DB));
    r = lerp(110, r, strength); g = lerp(110, g, strength); b = lerp(110, b, strength);
  }
  const hex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}
