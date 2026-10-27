/**
 * 2026-10-26 (Tim: "the blue club line stays with the arc, not the golfer's hands") — WHERE THE BLUE CLUB IS
 * AT ONE INSTANT, or nothing.
 *
 * The overlay used to pin the clubhead to the arc's FIRST point for any time before it and its LAST point
 * for any time after it (three clamps), and drew the shaft to the wrist midpoint of a pose interpolated
 * between ~20 body reads. Through address and the finish the hands moved while the head sat frozen on an
 * arc end, so the "club" was a line from the hands to wherever the arc stopped; and between sparse pose
 * samples the grip end was a guess beside a head measured at 30-60fps.
 *
 * Now:
 *   - the HEAD exists only inside the measured arc, and only where the two detections around the instant
 *     are close in time (MAX_ARC_GAP_MS): no gliding across a stretch the tracker did not see;
 *   - the GRIP is the tracker's measured inner end of the moving shaft (gx/gy), interpolated under the
 *     same gap rule. No measured grip (every arc stored before 10-26, the vision fallback, a frame where
 *     the shaft was not seen) means NO shaft — the head dot alone. Never the interpolated wrists.
 * Pure: SwingBodyOverlay draws what this returns.
 */
import { catmullRomPoint, type ArcPoint } from './smoothArc';

/** Two detections further apart than this bracket a stretch the tracker did not see (30fps = 33ms a frame,
 *  so one missing frame still bridges; a Viterbi "not seen" run does not). */
export const MAX_ARC_GAP_MS = 80;

export type GripSample = { t: number; x: number; y: number };
export type ClubShaft = { head: { x: number; y: number }; grip: { x: number; y: number } | null };

/** The bracket [i, i+1] holding t, or -1 (outside the span, or across a gap). Points in time order. */
function bracket(P: readonly { t: number }[], t: number, maxGapMs: number): number {
  if (P.length < 2 || !(t >= P[0].t) || !(t <= P[P.length - 1].t)) return -1;
  for (let i = 0; i < P.length - 1; i++) {
    if (t >= P[i].t && t <= P[i + 1].t) return P[i + 1].t - P[i].t <= maxGapMs ? i : -1;
  }
  return -1;
}

/**
 * @param head  the cleaned clubhead arc (the same points the trace is drawn through), frame pixels, ms.
 * @param grips the measured grips, frame pixels, ms — only the points that carry one. A grip whose head is not
 *              in `head` (rejected as a spike) is not used.
 */
export function clubShaftAt(
  head: readonly ArcPoint[], grips: readonly GripSample[], tMs: number, maxGapMs = MAX_ARC_GAP_MS,
): ClubShaft | null {
  const i = bracket(head, tMs, maxGapMs);
  if (i < 0) return null;
  const a = head[i], b = head[i + 1];
  const s = b.t > a.t ? (tMs - a.t) / (b.t - a.t) : 0;
  // The same centripetal Catmull-Rom the trace is drawn with, so the head sits ON its own arc.
  const h = catmullRomPoint(head[i - 1] ?? a, a, b, head[i + 2] ?? b, s);
  if (!Number.isFinite(h.x) || !Number.isFinite(h.y)) return null;
  let grip: ClubShaft['grip'] = null;
  // 2026-10-27 (seam review) — a grip counts only where its HEAD was kept: `head` is the cleaned arc (a spike —
  // the leg or a shadow taken for the head — is dropped there), and the grip measured from a bogus head is bogus
  // too. Interpolating against it swung the shaft off the hands while the head was bridged across the hole.
  const kept = new Set(head.map((p) => p.t));
  const G = grips.filter((g) => kept.has(g.t));
  const j = bracket(G, tMs, maxGapMs);
  if (j >= 0) {
    const g0 = G[j], g1 = G[j + 1];
    const u = g1.t > g0.t ? (tMs - g0.t) / (g1.t - g0.t) : 0;
    const g = { x: g0.x + (g1.x - g0.x) * u, y: g0.y + (g1.y - g0.y) * u };
    if (Number.isFinite(g.x) && Number.isFinite(g.y)) grip = g;
  }
  return { head: { x: h.x, y: h.y }, grip };
}
