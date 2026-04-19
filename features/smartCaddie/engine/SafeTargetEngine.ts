/**
 * SafeTargetEngine.ts
 *
 * Pure pixel-space engine that automatically selects the safest landing
 * target for SmartVision, factoring in:
 *   - Hazard proximity (pixel-space circles from courses.ts Hazard)
 *   - Player miss bias ('left' | 'right' | 'balanced')
 *   - Distance to pin (favour shorter targets to avoid over-shooting)
 *
 * All inputs are 2-D pixel coordinates.
 * Target must complete in <50 ms — the algorithm is O(candidates × hazards)
 * with both arrays kept intentionally small (≤15 candidates, ≤12 hazards).
 *
 * No GPS. No async. No side-effects.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface Px2D { x: number; y: number }

export interface PixelHazard {
  cx:   number; // hazard centre x (pixels)
  cy:   number; // hazard centre y (pixels)
  rPx:  number; // hazard radius   (pixels)
  type: 'water' | 'bunker' | 'ob';
  /** preferred side to miss: 'left' | 'right' | 'short' | 'long' */
  avoidDir?: string;
}

export interface SafeTargetCandidate {
  /** Pixel position of this candidate */
  px: Px2D;
  /**
   * Lateral offset from the centre line (in pixels, negative = left of dir,
   * positive = right). Centre-line candidates have offset = 0.
   */
  lateralOffsetPx: number;
  /**
   * Parametric distance from ball along the ball→pin direction (0 = ball, 1 = pin).
   */
  t: number;
}

export interface SafeTargetResult {
  /** Best candidate pixel position */
  target:   Px2D;
  /** Combined risk score of the winning candidate (lower is safer) */
  risk:     number;
  /** Whether the result was driven by hazard avoidance or is the plain centre line */
  isAvoiding: boolean;
  /** Human-readable rationale (max ~40 chars) */
  reason:   string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Candidate generation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate landing-zone candidates along the ball→pin centre line plus
 * lateral offsets left/right of it.
 *
 * @param ball      Ball pixel position
 * @param pin       Pin (green) pixel position
 * @param tSteps    Parametric steps along ball→pin (0–1). Default: 0.25, 0.40, 0.55
 * @param lateralSteps  Lateral offset pixel values. Default: [0, ±40, ±80]
 */
export function generateCandidates(
  ball: Px2D,
  pin:  Px2D,
  tSteps:       number[] = [0.25, 0.40, 0.55],
  lateralSteps: number[] = [0, 40, -40, 70, -70],
): SafeTargetCandidate[] {
  const dx  = pin.x - ball.x;
  const dy  = pin.y - ball.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return [];

  // Unit direction along ball→pin
  const ux = dx / len;
  const uy = dy / len;

  // Perpendicular (left of direction)
  const px = -uy;
  const py = ux;

  const candidates: SafeTargetCandidate[] = [];

  for (const t of tSteps) {
    // Centre-line point
    const cx = ball.x + ux * len * t;
    const cy = ball.y + uy * len * t;

    for (const lat of lateralSteps) {
      candidates.push({
        px:              { x: cx + px * lat, y: cy + py * lat },
        lateralOffsetPx: lat,
        t,
      });
    }
  }

  return candidates;
}

// ─────────────────────────────────────────────────────────────────────────────
// Risk scoring
// ─────────────────────────────────────────────────────────────────────────────

const HAZARD_WEIGHT: Record<string, number> = {
  water:  80,
  ob:     70,
  bunker: 40,
};

/**
 * Score a single candidate — lower is safer.
 *
 * Miss bias: if the player tends to miss left/right and the candidate is
 * on the same side as a high-risk hazard, the risk is amplified by 1.5×.
 */
export function scoreCandidate(
  candidate: SafeTargetCandidate,
  hazards:   PixelHazard[],
  missBias:  'left' | 'right' | 'balanced',
): number {
  let risk = 0;

  for (const h of hazards) {
    const ddx  = candidate.px.x - h.cx;
    const ddy  = candidate.px.y - h.cy;
    const dist = Math.sqrt(ddx * ddx + ddy * ddy);
    const baseWeight = HAZARD_WEIGHT[h.type] ?? 40;

    // Proximity penalty — diminishes quickly beyond the radius
    if (dist < h.rPx) {
      // Inside hazard circle — very high penalty
      risk += baseWeight * 5;
    } else if (dist < h.rPx * 1.5) {
      risk += baseWeight * 2;
    } else if (dist < h.rPx * 2.5) {
      risk += baseWeight * 0.8;
    }

    // Miss-bias amplifier: player tends to mis-hit toward this side of the hazard
    if (missBias !== 'balanced') {
      const isHazardRight = h.cx > candidate.px.x;
      const isHazardLeft  = !isHazardRight;
      if ((missBias === 'right' && isHazardRight) || (missBias === 'left' && isHazardLeft)) {
        risk *= 1.5;
      }
    }
  }

  // Slight penalty for large lateral offsets (prefer on-line shots)
  risk += Math.abs(candidate.lateralOffsetPx) * 0.08;

  // Slight preference for shorter (safer carry distance) — penalty grows for long t
  risk += candidate.t * 8;

  return risk;
}

// ─────────────────────────────────────────────────────────────────────────────
// Best target selection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Select the safest landing target from the candidate list.
 *
 * Returns null if no valid candidates (map not laid out yet).
 */
export function selectSafeTarget(
  ball:     Px2D,
  pin:      Px2D,
  hazards:  PixelHazard[],
  missBias: 'left' | 'right' | 'balanced',
): SafeTargetResult | null {
  const candidates = generateCandidates(ball, pin);
  if (candidates.length === 0) return null;

  let best      = candidates[0];
  let bestRisk  = Infinity;

  for (const c of candidates) {
    const risk = scoreCandidate(c, hazards, missBias);
    if (risk < bestRisk) {
      bestRisk = risk;
      best     = c;
    }
  }

  // Determine whether the winner is off-centre (avoiding something)
  const isAvoiding   = Math.abs(best.lateralOffsetPx) > 10 || (hazards.length > 0 && bestRisk > 0);
  const sideLabel    = best.lateralOffsetPx > 15 ? ' right' : best.lateralOffsetPx < -15 ? ' left' : '';
  const avoidLabel   = hazards.length > 0 ? ` · avoids ${hazards[0].type}` : '';
  const reason       = isAvoiding
    ? `Safest zone${sideLabel}${avoidLabel}`
    : 'Clear fairway target';

  return {
    target:     best.px,
    risk:       bestRisk,
    isAvoiding,
    reason,
  };
}
