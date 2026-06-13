/**
 * 2026-06-13 — Putt roll decomposition (the tripod watch-the-roll core).
 *
 * Given the ball's tracked roll path (a list of normalized centroids) from a
 * fixed camera behind the ball, plus where the player aimed and where the hole
 * is, decompose what happened into the three honest, MEASURED components Tim
 * asked for:
 *   1. start direction  — how the ball came off the face vs the aim line (face/path)
 *   2. break            — the curvature that developed AFTER a straight start (the
 *                         green acting on the ball = undulation/slope)
 *   3. speed            — pace from the deceleration profile (green-speed proxy)
 * and an ATTRIBUTION (start% vs slope%) — "how much of the miss was your start
 * line vs the green."
 *
 * HONESTY: this is RELATIVE, not metric (v1). We report degrees off the aim line,
 * the curvature as a fraction of the roll, and pace as slow/medium/fast — all
 * directly measured from the path geometry. We do NOT claim inches of break or a
 * true stimp number; that needs camera-perspective homography (v2, see
 * docs/putting-tripod-spec.md). Nothing here is fabricated — if the path is too
 * short to read, we return null rather than guess.
 *
 * PURE, SYNC, never throws, no React/network/store. Unit-tested with synthetic
 * paths; the CV that produces the real path (extending api/ball-departure to a
 * full track) is the separate piece tuned on real footage — same split as
 * services/swing/ballTrace.ts. See memory: putting-analysis-idea, green-heat-mapping-goal.
 */

import { computeTraceDirection, type TraceSide } from '../swing/ballTrace';

export interface RollPoint {
  /** Normalized full-frame coords (0..1). */
  x: number;
  y: number;
  /** Seconds (or monotonic frame index) — used only for the speed/decel read. */
  t: number;
}

export type BreakMagnitude = 'flat' | 'subtle' | 'moderate' | 'big';
export type Pace = 'slow' | 'medium' | 'fast';
export type RollLength = 'short' | 'good' | 'long' | 'unknown';

export interface PuttRollAnalysis {
  /** How the ball left the face relative to the aim line. */
  startDirection: { side: TraceSide; divergenceDeg: number };
  /** The curve that developed after a straight start = the green acting. */
  break: { side: TraceSide; magnitude: BreakMagnitude; curvatureFraction: number };
  /** Pace from the deceleration profile (green-speed proxy). */
  speed: { pace: Pace; decelRatio: number; rollLength: RollLength };
  /** How much of the lateral result owed to the start line vs the green. */
  attribution: { startPct: number; slopePct: number };
  /** Outcome vs the hole, when the hole is known. */
  outcome: { result: 'made' | 'missed' | 'unknown'; missSide: TraceSide | 'short' | 'long' | null };
  /** The honest one-line read. */
  relativeRead: string;
  confidence: 'high' | 'medium' | 'low';
  /** 0..1 — how much of the roll the tracker actually saw. */
  trackedFraction: number;
}

const STRAIGHT_DEG = 4;            // within this of the aim line reads as straight
const MADE_FRACTION = 0.05;        // end within 5% of frame of the hole = holed

function unit(dx: number, dy: number): { x: number; y: number; len: number } {
  const len = Math.hypot(dx, dy);
  return len < 1e-6 ? { x: 0, y: 0, len: 0 } : { x: dx / len, y: dy / len, len };
}

function magBucket(frac: number): BreakMagnitude {
  if (frac < 0.02) return 'flat';
  if (frac < 0.06) return 'subtle';
  if (frac < 0.14) return 'moderate';
  return 'big';
}

/**
 * Decompose a putt roll. Returns null when the path is too short to read honestly
 * (< 3 points or no measurable travel) — we never invent a roll we didn't see.
 */
export function analyzePuttRoll(input: {
  path: RollPoint[];
  aim?: { x: number; y: number } | null;
  hole?: { x: number; y: number } | null;
  /** 0..1 — caller's confidence that the tracker followed the whole roll. */
  trackedFraction?: number;
}): PuttRollAnalysis | null {
  const path = input.path ?? [];
  if (path.length < 3) return null;

  const start = path[0];
  const end = path[path.length - 1];
  const total = unit(end.x - start.x, end.y - start.y);
  if (total.len < 0.02) return null; // ball never meaningfully moved

  const target = input.hole ?? input.aim ?? null;

  // ── 1) Start direction: heading over the first ~18% of the roll vs the aim line.
  // Reuse ballTrace's aim-relative direction math (single source of truth).
  const earlyIdx = Math.max(1, Math.round(path.length * 0.18));
  const early = path[Math.min(earlyIdx, path.length - 1)];
  const dir = computeTraceDirection({ x: start.x, y: start.y }, { x: early.x, y: early.y }, target);
  const startDirection = dir
    ? { side: dir.side, divergenceDeg: dir.divergenceDeg }
    : { side: 'straight' as TraceSide, divergenceDeg: 0 };

  // ── 2) Break: deviation of the END from the line the ball STARTED on.
  // Initial heading u from start→early; rightNormal points right of travel.
  const u = unit(early.x - start.x, early.y - start.y);
  const rightN = { x: -u.y, y: u.x };
  // Project the full start→end displacement; the perpendicular part is the curve.
  const disp = { x: end.x - start.x, y: end.y - start.y };
  const along = disp.x * u.x + disp.y * u.y;
  const lateral = disp.x * rightN.x + disp.y * rightN.y; // signed: + = right of travel
  const curvatureFraction = total.len > 0 ? Math.abs(lateral) / total.len : 0;
  const breakSide: TraceSide =
    curvatureFraction < 0.02 ? 'straight' : lateral > 0 ? 'right' : 'left';
  const breakInfo = { side: breakSide, magnitude: magBucket(curvatureFraction), curvatureFraction };

  // ── 3) Speed: deceleration across the roll (green-speed proxy) + roll length.
  const speeds: number[] = [];
  for (let i = 1; i < path.length; i++) {
    const d = Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
    const dt = Math.max(1e-3, path[i].t - path[i - 1].t);
    speeds.push(d / dt);
  }
  const firstSpeed = speeds[0] || 0;
  const lastSpeed = speeds[speeds.length - 1] || 0;
  const decelRatio = firstSpeed > 1e-6 ? Math.max(0, Math.min(1, 1 - lastSpeed / firstSpeed)) : 0;
  // High decel = ball grabs quickly = SLOW green; low decel = keeps rolling = FAST green.
  const pace: Pace = decelRatio >= 0.7 ? 'slow' : decelRatio <= 0.4 ? 'fast' : 'medium';

  // Roll length vs the hole (only when hole known): did it get there?
  let rollLength: RollLength = 'unknown';
  let outcome: PuttRollAnalysis['outcome'] = { result: 'unknown', missSide: null };
  if (input.hole) {
    const toHole = unit(input.hole.x - start.x, input.hole.y - start.y);
    const endToHole = Math.hypot(end.x - input.hole.x, end.y - input.hole.y);
    const alongToHole = (end.x - start.x) * toHole.x + (end.y - start.y) * toHole.y;
    if (endToHole <= MADE_FRACTION) {
      rollLength = 'good';
      outcome = { result: 'made', missSide: null };
    } else {
      rollLength = alongToHole < toHole.len * 0.92 ? 'short' : alongToHole > toHole.len * 1.08 ? 'long' : 'good';
      // Miss side: lateral sign relative to the start→hole line.
      const holeRightN = { x: -toHole.y, y: toHole.x };
      const endLateral = (end.x - input.hole.x) * holeRightN.x + (end.y - input.hole.y) * holeRightN.y;
      const missSide: PuttRollAnalysis['outcome']['missSide'] =
        rollLength === 'short' ? 'short' : rollLength === 'long' ? 'long'
          : endLateral > 0 ? 'right' : 'left';
      outcome = { result: 'missed', missSide };
    }
  }

  // ── Attribution: lateral miss owed to start-line error vs green-induced curve.
  // start component = how far the initial heading error would push the ball over
  // the along-distance it traveled; slope component = the measured curvature lateral.
  const startRad = (startDirection.divergenceDeg * Math.PI) / 180;
  const startComponent = Math.abs(Math.sin(startRad) * Math.abs(along));
  const slopeComponent = Math.abs(lateral);
  const denom = startComponent + slopeComponent;
  const startPct = denom < 1e-6 ? 50 : Math.round((startComponent / denom) * 100);
  const attribution = { startPct, slopePct: 100 - startPct };

  // ── Confidence: needs enough points + tracked fraction to trust the read.
  const tf = typeof input.trackedFraction === 'number'
    ? Math.max(0, Math.min(1, input.trackedFraction))
    : Math.min(1, path.length / 12);
  const confidence: PuttRollAnalysis['confidence'] =
    tf >= 0.8 && path.length >= 8 ? 'high' : tf >= 0.5 ? 'medium' : 'low';

  return {
    startDirection,
    break: breakInfo,
    speed: { pace, decelRatio: Math.round(decelRatio * 100) / 100, rollLength },
    attribution,
    outcome,
    relativeRead: composeRelativeRead(startDirection, breakInfo, pace, attribution, outcome),
    confidence,
    trackedFraction: Math.round(tf * 100) / 100,
  };
}

function composeRelativeRead(
  start: PuttRollAnalysis['startDirection'],
  brk: PuttRollAnalysis['break'],
  pace: Pace,
  attr: PuttRollAnalysis['attribution'],
  outcome: PuttRollAnalysis['outcome'],
): string {
  const parts: string[] = [];
  parts.push(
    start.side === 'straight'
      ? 'Started on your line'
      : `Started ${start.divergenceDeg}° ${start.side} of your aim`,
  );
  parts.push(
    brk.side === 'straight'
      ? 'and held straight'
      : `then broke ${brk.magnitude} to the ${brk.side}`,
  );
  parts.push(pace === 'fast' ? '— quick green' : pace === 'slow' ? '— slow green' : '— medium pace');
  let read = parts.join(' ') + '.';
  // Attribute the miss only when there was a real lateral cause (start error or
  // break) — a pure short/long miss has no left/right story to split.
  const hasLateral = start.side !== 'straight' || brk.side !== 'straight';
  if (outcome.result === 'missed' && hasLateral) {
    read += ` ${attr.startPct}% of that miss was your start line, ${attr.slopePct}% was the green.`;
  }
  return read;
}
