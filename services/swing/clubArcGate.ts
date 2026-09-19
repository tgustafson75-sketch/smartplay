/**
 * IS THIS SET OF DETECTIONS A REAL CLUBHEAD SWEEP? One answer, one place, both sides of the wire.
 *
 * 2026-09-19, from a field report — a brand-new player's first swing on a Pixel 8a:
 *
 *     analysis_error: clubpath_arc_too_sparse
 *     { points: 0, detected: 2, rejected: "too_few", gate: "client",
 *       framesSampled: 14, windowMs: 1544, aborted: false }
 *
 * `gate: "client"` is the part that matters, and it was a lie told by the architecture rather than
 * by the code. services/swing/clubPath's own comment at that branch read:
 *
 *     "Reached only when the CLIENT gate rejects a set the server ACCEPTED — the two mirror each
 *      other, so this firing at all is itself worth seeing in the log."
 *
 * They did not mirror each other. `looksLikeClubArc` existed TWICE — once in api/club-path.ts and
 * once in services/swing/clubPath.ts — and the client ran one extra step the server did not: it
 * DEDUPES near-identical detections (a static repeat read) before counting them. So the ordinary
 * outcome of a blurred downswing, where the model returns the same coordinates for two adjacent
 * frames, was: the server counts 3 and accepts, the client dedupes to 2 and rejects — and the log
 * reports a client/server disagreement, which is exactly the thing the comment says should never
 * happen. The most alarming field in the report was an artefact of a rule living in two files.
 *
 * So the rule moves here, dedupe included, and both sides call it. After this, `gate: 'client'`
 * means what its comment always claimed: a genuine disagreement, worth investigating.
 *
 * PURE — no React, no RN, no fetch — because it is imported by a Vercel function AND by the app,
 * the same way services/clubBagReconcile is. [[two-owners-is-the-root-cause]]
 * [[a-guard-can-assert-the-broken-shape]]
 */

export type ArcPoint = { x: number; y: number };

/**
 * Minimum clearly-detected points before the set can be a real arc.
 *
 * 2026-08-06 (Tim — the blue club never showed): lowered 4→3. Sonnet returns null through the
 * blurred downswing, so a valid partial sweep frequently has only 3 confident points; a 4-gate on
 * the server PLUS a client gate double-rejected them into all-null.
 */
export const MIN_ARC_POINTS = 3;

/**
 * How far apart two detections must be to count as two points, in normalized frame units.
 *
 * A repeat read of a stationary head — or of the same blurred smear across two adjacent frames — is
 * one observation reported twice, not two points of a sweep. 0.004 is ~4 pixels on a 1080-wide
 * frame: tight enough that real clubhead travel between samples always clears it (the head covers a
 * substantial fraction of the frame in 100ms), loose enough to collapse a jitter.
 */
export const ARC_DEDUPE_MIN_SEPARATION = 0.004;

/**
 * Collapse consecutive detections that sit on top of each other.
 *
 * Order-preserving and consecutive-only on purpose: an arc that genuinely returns to near a earlier
 * point (a full swing doubling back) keeps both, because those ARE two moments of the sweep.
 */
export function dedupeArcPoints<T extends ArcPoint>(pts: readonly T[]): T[] {
  return pts.filter((p, i) =>
    i === 0 || Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) > ARC_DEDUPE_MIN_SEPARATION);
}

/**
 * 2026-07-22 (Tim — "the club is consistently off; trace it correctly") — a real swing arc spans a
 * meaningful fraction of the frame; a cluster is a mis-detection (the ball, the grip, or a
 * background object read as the head).
 *
 * 2026-08-06 — span ALONE is not enough: 3 unrelated confident detections (address grip + the ball
 * + a bright background object) span a wide box and used to pass, drawing a blue shaft through
 * garbage. A real clubhead SWEEP progresses; a scatter zig-zags. Gate on path EFFICIENCY =
 * straight-line distance first→last ÷ total path length. A quarter-to-half-circle arc scores
 * ~0.57–0.64; grip/ball/background scatter scores ~0.26.
 *
 * 2026-08-08 — whole-path efficiency STRUCTURALLY rejects a COMPLETE swing: address→top→impact→
 * finish doubles back, so netSpan/pathLen lands ~0.33 and a perfect full-swing arc was thrown away
 * as "scatter", deterministically, on every retry. A real sweep is SMOOTH PER LEG while scatter
 * zig-zags at every scale — so pass if the whole path is efficient, otherwise split at the apex
 * (farthest point from the start, i.e. the top of the swing) and require each leg to be efficient,
 * recursing one more level for legs that themselves double back (impact→finish).
 */
export function looksLikeClubArc(pts: readonly ArcPoint[]): boolean {
  if (pts.length < MIN_ARC_POINTS) return false;
  let minX = 1, maxX = 0, minY = 1, maxY = 0;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const spanX = maxX - minX, spanY = maxY - minY;
  if (Math.max(spanX, spanY) < 0.10) return false;
  if (spanX + spanY < 0.13) return false;

  let pathLen = 0;
  for (let i = 1; i < pts.length; i++) {
    pathLen += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  if (pathLen <= 1e-6) return false;

  const eff = (a: number, b: number): boolean => {
    let len = 0;
    for (let i = a + 1; i <= b; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (len <= 1e-6) return false;
    return Math.hypot(pts[b].x - pts[a].x, pts[b].y - pts[a].y) / len >= 0.45;
  };
  const smooth = (a: number, b: number, depth: number): boolean => {
    if (eff(a, b)) return true;
    /**
     * 2026-08-10 (Tim — "no trace for a week") — was `< 5`, which on a SPARSE real arc (the clubhead
     * is detected in ~6-8 frames, not all 14) left the doubled-back downswing leg too short to
     * split, rejecting valid full swings as scatter. Legs down to 3 points; the span gates above
     * remain the primary blob/scatter defence.
     */
    if (depth <= 0 || b - a < 2) return false;
    let apex = a + 1, best = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.hypot(pts[i].x - pts[a].x, pts[i].y - pts[a].y);
      if (d > best) { best = d; apex = i; }
    }
    if (apex <= a + 1 || apex >= b - 1) return false; // apex at an end = no real turnaround
    return smooth(a, apex, depth - 1) && smooth(apex, b, depth - 1);
  };
  return smooth(0, pts.length - 1, 2);
}

/**
 * WHY a set was refused, or null when it is a usable arc.
 *
 *   too_few  — the model genuinely could not see the head. A CAPTURE problem: light, angle, frame rate.
 *   cluster  — it found points, but they collapse to a blob. A MIS-DETECTION (ball, grip, background).
 *   scatter  — it found points that zig-zag rather than sweep. Also a mis-detection.
 *   none     — nothing came back at all.
 *
 * Every rejection used to reach the field as the same line, `points: 0`, and that one number covers
 * four different failures with four different fixes — it sends you to the camera when the problem is
 * the prompt, or the reverse. [[the-app-log-knows-whats-wrong]]
 */
export type ArcRejection = 'none' | 'too_few' | 'cluster' | 'scatter';

/**
 * Classify a set of detections. DEDUPES FIRST, always — that is the change of 2026-09-19, and the
 * whole point of this file existing: the count that decides `too_few` must be the same count on both
 * sides of the wire.
 *
 * Returns the rejection AND the deduped count, because the caller has to report the number the
 * decision was actually made on. Reporting the raw count beside a decision made on the deduped one
 * is how the field report came to say something that was not true.
 */
export function classifyArc(raw: readonly ArcPoint[]): { rejection: ArcRejection | null; points: ArcPoint[] } {
  if (raw.length === 0) return { rejection: 'none', points: [] };
  const points = dedupeArcPoints(raw);
  if (points.length < MIN_ARC_POINTS) return { rejection: 'too_few', points };

  let minX = 1, maxX = 0, minY = 1, maxY = 0;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const spanX = maxX - minX, spanY = maxY - minY;
  if (Math.max(spanX, spanY) < 0.10 || spanX + spanY < 0.13) return { rejection: 'cluster', points };
  return { rejection: looksLikeClubArc(points) ? null : 'scatter', points };
}
