/**
 * features/playView/engine/GreenRead.ts
 *
 * Calculates a Bézier control point for a curved putt break line.
 * Pure function — no React, no side effects.
 */

export type SlopeDirection = 'left' | 'right' | 'uphill' | 'downhill' | null;

export interface BreakInput {
  start: { x: number; y: number };
  end:   { x: number; y: number };
  slope: SlopeDirection;
}

export interface BreakResult {
  /** Quadratic Bézier control point — pull the path away from a straight line */
  control:    { x: number; y: number };
  /** Aim-point offset in pixels from hole centre (point the player should aim AT) */
  aimOffset:  { x: number; y: number };
  /** Simple human-readable speed instruction */
  speedHint:  string;
  /** Short slope label for the info bar */
  slopeLabel: string;
}

const BREAK_STRENGTH = 28; // pixels — visual curve amount

export function calculateBreak({ start, end, slope }: BreakInput): BreakResult {
  const mx = (start.x + end.x) / 2;
  const my = (start.y + end.y) / 2;

  let cx = mx;
  let cy = my;

  // Perpendicular nudge direction based on slope
  // (break pulls the midpoint away from a straight line)
  switch (slope) {
    case 'left':
      cx -= BREAK_STRENGTH;
      break;
    case 'right':
      cx += BREAK_STRENGTH;
      break;
    case 'uphill':
      cy -= BREAK_STRENGTH * 0.6; // uphill breaks less laterally
      break;
    case 'downhill':
      cy += BREAK_STRENGTH * 0.6;
      break;
    default:
      break;
  }

  // Aim-point offset: aim AGAINST the break so it curves back to hole
  const aimOffset = { x: 0, y: 0 };
  if (slope === 'left')     aimOffset.x = -10;
  if (slope === 'right')    aimOffset.x =  10;
  if (slope === 'uphill')   aimOffset.y = -8;
  if (slope === 'downhill') aimOffset.y =  8;

  const speedHint =
    slope === 'downhill' ? 'Soft touch — gravity helps' :
    slope === 'uphill'   ? 'Firm stroke — fight the hill' :
    slope === 'left'     ? 'Normal pace, aim right edge' :
    slope === 'right'    ? 'Normal pace, aim left edge' :
    'Normal pace';

  const slopeLabel =
    slope === 'left'      ? 'Right to left' :
    slope === 'right'     ? 'Left to right' :
    slope === 'uphill'    ? 'Uphill' :
    slope === 'downhill'  ? 'Downhill' :
    'Flat';

  return {
    control:    { x: cx, y: cy },
    aimOffset,
    speedHint,
    slopeLabel,
  };
}
