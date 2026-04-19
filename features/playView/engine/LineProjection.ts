/**
 * LineProjection.ts
 *
 * Pure pixel-space geometry utilities.
 * Used to detect which hazards intersect a target line and compute
 * carry / clear distances along that line.
 *
 * All coordinates are 2-D pixel coords — no GPS, no async.
 */

export interface Point2D { x: number; y: number }

// ─────────────────────────────────────────────────────────────────────────────
// Core projection — closest point on segment AB to point P
// ─────────────────────────────────────────────────────────────────────────────

export interface SegmentProjection {
  /** Projected point on segment AB */
  x: number;
  y: number;
  /**
   * Parameterised position along AB [0, 1].
   * 0 = at A, 1 = at B, values outside range are clamped.
   */
  t: number;
}

/**
 * Project point P onto the line segment A→B.
 * Returns the closest point on (not past) the segment plus t ∈ [0, 1].
 */
export function projectPointToSegment(
  p: Point2D,
  a: Point2D,
  b: Point2D,
): SegmentProjection {
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const ab2 = abx * abx + aby * aby;

  if (ab2 === 0) return { x: a.x, y: a.y, t: 0 }; // degenerate: A = B

  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / ab2));
  return {
    x: a.x + abx * t,
    y: a.y + aby * t,
    t,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Distance along segment to a circular hazard
// ─────────────────────────────────────────────────────────────────────────────

export interface HazardOnLine {
  /** Original index in the caller's hazard array */
  index:    number;
  /** Pixel distance from A to the near edge of the hazard (carry) */
  carryPx:  number;
  /** Pixel distance from A to the far edge of the hazard (clear) */
  clearPx:  number;
  /** Pixel coord of the closest projected point on segment to hazard centre */
  proj:     Point2D;
  /** t parameter — 0=near A, 1=near B  */
  t:        number;
}

/**
 * Given a shot line from A (player) to B (target) and a list of circular
 * hazards (each with a centre in pixels and a radius in pixels), return only
 * those hazards that the line passes through (or within).
 *
 * Max pixels from line counted as "on line" = hazardRadiusPx.
 */
export function detectHazardsOnLine(
  a: Point2D,
  b: Point2D,
  hazards: { cx: number; cy: number; rPx: number }[],
): HazardOnLine[] {
  const abx  = b.x - a.x;
  const aby  = b.y - a.y;
  const abLen = Math.sqrt(abx * abx + aby * aby);
  if (abLen < 1) return [];

  const results: HazardOnLine[] = [];

  hazards.forEach((h, i) => {
    const proj = projectPointToSegment({ x: h.cx, y: h.cy }, a, b);
    const dx   = h.cx - proj.x;
    const dy   = h.cy - proj.y;
    const distToLine = Math.sqrt(dx * dx + dy * dy);

    if (distToLine >= h.rPx) return; // hazard doesn't intersect the line

    // Distance from A to projected point along segment
    const projDist = proj.t * abLen;

    // Half-chord length inside the circle (Pythagorean)
    const halfChord = Math.sqrt(Math.max(0, h.rPx * h.rPx - distToLine * distToLine));

    results.push({
      index:   i,
      carryPx: Math.max(0, projDist - halfChord),
      clearPx: projDist + halfChord,
      proj:    { x: proj.x, y: proj.y },
      t:       proj.t,
    });
  });

  // Sort by carry distance (closest first)
  results.sort((a, b) => a.carryPx - b.carryPx);
  return results;
}
