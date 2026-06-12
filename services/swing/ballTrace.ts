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
  // Angle measured with +x = right, up-the-frame = forward (so atan2(x, -y)).
  const aimAng = Math.atan2(avx, -avy);
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

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * Math.max(0, Math.min(1, t)));
}

/**
 * Green → amber → red by how far off the aim line the ball started. Straight = green
 * (#34d399), a big hook/slice = red (#ef4444). When `peakDb` is supplied and the
 * strike was weak relative to `peakDbRef` (the session's solid-strike energy), the
 * colour is dimmed toward grey — an honest "soft contact" cue. Returns a hex string.
 */
export function traceColor(divergenceDeg: number, peakDb?: number, peakDbRef?: number): string {
  const t = Math.max(0, Math.min(1, (divergenceDeg - STRAIGHT_DEG) / (RED_DEG - STRAIGHT_DEG)));
  // Green (52,211,153) → amber (245,158,11) → red (239,68,68).
  let r: number, g: number, b: number;
  if (t < 0.5) {
    const u = t / 0.5;
    r = lerp(52, 245, u); g = lerp(211, 158, u); b = lerp(153, 11, u);
  } else {
    const u = (t - 0.5) / 0.5;
    r = lerp(245, 239, u); g = lerp(158, 68, u); b = lerp(11, 68, u);
  }
  // Weak-strike dim: if this strike's energy is well below the reference, fade it.
  if (typeof peakDb === 'number' && typeof peakDbRef === 'number' && peakDbRef > 0) {
    const strength = Math.max(0.4, Math.min(1, peakDb / peakDbRef));
    r = lerp(110, r, strength); g = lerp(110, g, strength); b = lerp(110, b, strength);
  }
  const hex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}
