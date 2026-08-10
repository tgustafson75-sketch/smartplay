/**
 * 2026-08-10 (Tim — "the honest club-path faults, from the club arc"). The over-the-top / steep /
 * shallow family is a CLUB-PLANE phenomenon — it lives in the shape of the clubhead PATH, not in
 * hip/shoulder widths (that proxy was fabricated and removed). This reads the plane geometry from the
 * REAL detected clubhead arc (services/swing/clubPath → /api/club-path), which is the signal every
 * serious analyzer uses.
 *
 * PURE + deterministic + camera-angle gated. Returns a measured descriptor and (when unambiguous) a
 * fault. It NEVER fabricates: no arc / too few points / non-DTL / an ambiguous read → null.
 *
 * ⚠️ PROVISIONAL CALIBRATION: the plane geometry is sound and unit-tested against synthetic
 * over-the-top vs on-plane arcs, but the exact ANGLE THRESHOLD (and, if a camera is mirrored, the sign)
 * must be confirmed against a real down-the-line clip with a KNOWN over-the-top before the fault is
 * trusted as elite. Until then it fires only on a clearly-steep transition (conservative) and is tagged
 * so the report can hedge. Same discipline as the body-fault thresholds.
 *
 * WHY it's viewpoint-robust: it compares the DOWNSWING limb's plane angle to the BACKSWING limb's plane
 * angle FROM THE SAME SWING (a self-referential delta), so it doesn't depend on an absolute plane line
 * or which side of the frame the target is on. Over-the-top = the club comes DOWN on a steeper, more
 * vertical line than it went UP (thrown out and over, then across). "Drop into the slot" = the
 * downswing is equal-or-shallower than the backswing.
 */

export interface ClubArcPoint { x: number; y: number; tMs: number }

export interface ClubPathRead {
  /** Backswing-limb plane angle from horizontal (deg, 0..90). null if unmeasurable. */
  backswingPlaneDeg: number | null;
  /** Downswing-limb plane angle from horizontal (deg, 0..90). */
  downswingPlaneDeg: number | null;
  /** downswing − backswing plane angle (deg). Positive = steeper coming down (the over-the-top signature). */
  planeDeltaDeg: number | null;
  /** Provisional classification — 'over_the_top' | 'shallow' | 'on_plane' | null (unmeasurable/ambiguous). */
  classification: 'over_the_top' | 'shallow' | 'on_plane' | null;
  /** True while the threshold/sign is pending real-clip calibration (report should hedge). */
  provisional: boolean;
}

const EMPTY: ClubPathRead = {
  backswingPlaneDeg: null, downswingPlaneDeg: null, planeDeltaDeg: null, classification: null, provisional: true,
};

/** Plane angle (deg from horizontal, 0..90) of the straight line from point a to point b. */
function planeAngleDeg(a: ClubArcPoint, b: ClubArcPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return 0;
  // |slope| relative to horizontal; steeper (more vertical) → closer to 90.
  return Math.round((Math.atan2(Math.abs(dy), Math.abs(dx)) * 180) / Math.PI);
}

/**
 * Read the club-plane geometry from a time-ordered clubhead arc.
 * @param arc       time-ordered clubhead points (full-frame normalized 0..1, y grows DOWN).
 * @param angle     camera angle — path faults are ONLY valid down-the-line; face_on/glasses → null.
 */
export function readClubPath(
  arc: ClubArcPoint[] | null | undefined,
  angle: 'down_the_line' | 'face_on' | 'glasses_pov' | null | undefined,
): ClubPathRead {
  // Path/plane is a DTL read. Face-on cannot see the plane (it's edge-on to the camera) — refuse rather
  // than fabricate, exactly like the pose metrics null their angle-invalid dimensions.
  if (angle !== 'down_the_line') return EMPTY;
  if (!arc || arc.length < 5) return EMPTY;
  const pts = [...arc].sort((p, q) => p.tMs - q.tMs);

  // The TOP = the highest clubhead (min y) — the transition between backswing and downswing. Must be
  // interior (a real reversal), not the first/last point.
  let topIdx = 0;
  for (let i = 1; i < pts.length; i++) if (pts[i].y < pts[topIdx].y) topIdx = i;
  if (topIdx < 2 || topIdx > pts.length - 3) return EMPTY; // need ≥2 points each side for a stable plane

  // The IMPACT/low point AFTER the top (max y in the downswing) bounds the downswing limb; ignore the
  // follow-through (which sweeps back up and would corrupt the downswing plane).
  let lowIdx = topIdx;
  for (let i = topIdx + 1; i < pts.length; i++) if (pts[i].y > pts[lowIdx].y) lowIdx = i;
  if (lowIdx - topIdx < 1) return EMPTY;

  // Backswing limb: address(0) → top. Downswing limb: top → impact/low.
  const back = planeAngleDeg(pts[0], pts[topIdx]);
  const down = planeAngleDeg(pts[topIdx], pts[lowIdx]);
  const delta = down - back;

  // Conservative provisional thresholds (PENDING real-clip calibration). A downswing clearly STEEPER
  // than the backswing = over-the-top; clearly SHALLOWER = under/shallow; within the band = on-plane.
  let classification: ClubPathRead['classification'];
  if (delta >= 12) classification = 'over_the_top';
  else if (delta <= -12) classification = 'shallow';
  else classification = 'on_plane';

  return {
    backswingPlaneDeg: back,
    downswingPlaneDeg: down,
    planeDeltaDeg: delta,
    classification,
    provisional: true,
  };
}
