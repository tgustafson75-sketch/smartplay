/**
 * 2026-06-13 — Golfshot-style layup planning (Tim's #6 spec).
 *
 * Pure decision helper: given the yards remaining to the green, decide whether
 * the hole view should draw ONE direct line (you can get there) or TWO lines —
 * a layup waypoint plus the green — so par-5s read as the strategic two-shot
 * plan instead of pretending one swing reaches.
 *
 * The rule Tim gave: under 200y → direct; 200y and over → lay up. The layup
 * leaves a comfortable full-wedge number (100y) when possible, but never asks
 * for an unrealistic carry — if leaving 100 would mean a >250y poke, it leaves
 * more so the layup shot stays sane.
 *
 * Pure + side-effect free so it's unit-tested by the sim harness and reused by
 * the hole view (smartvision) without dragging in any projection/GPS state.
 */

/** At or beyond this many yards to the green, plan a layup instead of a direct line. */
export const LAYUP_THRESHOLD_YARDS = 200;
/** Preferred yards to leave for the approach after a layup (a full wedge). */
const TARGET_LEAVE_YARDS = 100;
/** A layup shot shouldn't ask for more than this carry; leave more if it would. */
const MAX_LAYUP_CARRY_YARDS = 250;
/** ...nor less than this (else it's not really a layup — just go). */
const MIN_LAYUP_CARRY_YARDS = 40;

export interface AimPlan {
  /** 'direct' → one line to the green. 'layup' → two lines (layup waypoint → green). */
  mode: 'direct' | 'layup';
  /** Yards left to the green after the layup (the approach). null in direct mode. */
  leaveYards: number | null;
  /** Yards the layup shot itself carries (approach − leave). null in direct mode. */
  layupCarryYards: number | null;
}

/**
 * Plan the aim line(s) from `approachYards` to the green.
 * @param approachYards yards remaining to the green from the player/capture point
 *   (null/unknown → treated as direct, the safe non-committal default).
 */
export function planAimLines(approachYards: number | null | undefined): AimPlan {
  if (approachYards == null || !Number.isFinite(approachYards) || approachYards < LAYUP_THRESHOLD_YARDS) {
    return { mode: 'direct', leaveYards: null, layupCarryYards: null };
  }
  let leave = TARGET_LEAVE_YARDS;
  // Don't ask for an unrealistic layup carry — leave more if 100y out is too far.
  if (approachYards - leave > MAX_LAYUP_CARRY_YARDS) leave = approachYards - MAX_LAYUP_CARRY_YARDS;
  // ...and keep the layup itself a real shot, not a tap.
  if (approachYards - leave < MIN_LAYUP_CARRY_YARDS) leave = approachYards - MIN_LAYUP_CARRY_YARDS;
  const leaveYards = Math.round(leave);
  return { mode: 'layup', leaveYards, layupCarryYards: Math.round(approachYards - leaveYards) };
}

/**
 * Where the layup waypoint sits as a fraction (0..1) along the player→green axis.
 * 0 = at the player, 1 = at the green. null in direct mode (no waypoint).
 * Used by the hole view to place the layup marker between the origin and the pin.
 */
export function layupFraction(plan: AimPlan, approachYards: number | null | undefined): number | null {
  if (plan.mode !== 'layup' || plan.layupCarryYards == null || approachYards == null || approachYards <= 0) {
    return null;
  }
  return Math.max(0, Math.min(1, plan.layupCarryYards / approachYards));
}
