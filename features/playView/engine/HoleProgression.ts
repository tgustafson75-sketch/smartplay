/**
 * features/playView/engine/HoleProgression.ts
 *
 * Hole-completion state machine.
 *
 * States (in order of a typical hole):
 *
 *   approaching  — user is not yet on the tee
 *   playing      — user is at / past the tee, heading toward green
 *   onGreen      — user is within the green radius
 *   completed    — user has left the green (hole finished)
 *
 * Completion guard (prevents false triggers):
 *   • User must have been "onGreen" for ≥ GREEN_DWELL_MS (5 s)
 *   • User must now be > DEPARTURE_METRES (35 m) from the green
 *
 * The pure `getHoleState` function is used in tests / hot-path logic.
 * The stateful `progressionReducer` accumulates dwell time internally.
 */

import { isInZone } from '../utils/zone';
import { distanceBetween, type LatLng } from '../utils/distance';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Radius (m) around the *front* GPS coord to consider "on the green" */
export const GREEN_RADIUS_M   = 22;

/** Radius (m) around the *middle* GPS coord to consider "at the tee" */
export const TEE_RADIUS_M     = 35;

/** How long (ms) a player must stand on the green before completion is armed */
export const GREEN_DWELL_MS   = 5_000;

/** How far (m) from green the player must move before hole is marked complete */
export const DEPARTURE_METRES = 35;

// ── Types ─────────────────────────────────────────────────────────────────────

export type HolePhase = 'approaching' | 'playing' | 'onGreen' | 'completed';

export interface HoleCoords {
  /** Tee coords — use `middle` from CourseHole */
  tee:   LatLng;
  /** Green coords — use `front` from CourseHole (closest to pin) */
  green: LatLng;
}

export interface ProgressionState {
  phase:            HolePhase;
  /** Epoch ms when the player first entered the green zone this cycle */
  greenEnteredAt:   number | null;
  /** True once dwell condition is satisfied (can now complete) */
  completionArmed:  boolean;
}

export const INITIAL_PROGRESSION: ProgressionState = {
  phase:           'approaching',
  greenEnteredAt:  null,
  completionArmed: false,
};

// ── Pure state transition ─────────────────────────────────────────────────────

/**
 * Given the current GPS location, hole coords, previous state, and current
 * timestamp, return the next ProgressionState.
 *
 * Returns the SAME object reference when nothing changed (safe for === check
 * in use-effect deps).
 */
export function progressionReducer(
  prev:  ProgressionState,
  user:  LatLng,
  hole:  HoleCoords,
  nowMs: number,
): ProgressionState {
  const onGreen = isInZone(user, hole.green, GREEN_RADIUS_M);
  const atTee   = isInZone(user, hole.tee,   TEE_RADIUS_M);
  const distFromGreen = distanceBetween(user, hole.green);

  // ── Already completed — stay completed (caller resets on hole advance) ────
  if (prev.phase === 'completed') return prev;

  // ── On green ─────────────────────────────────────────────────────────────
  if (onGreen) {
    const enteredAt = prev.greenEnteredAt ?? nowMs;
    const dwell     = nowMs - enteredAt;
    const armed     = prev.completionArmed || dwell >= GREEN_DWELL_MS;

    // Nothing changed
    if (
      prev.phase           === 'onGreen' &&
      prev.greenEnteredAt  === enteredAt &&
      prev.completionArmed === armed
    ) return prev;

    return { phase: 'onGreen', greenEnteredAt: enteredAt, completionArmed: armed };
  }

  // ── Left the green — check completion ────────────────────────────────────
  if (prev.phase === 'onGreen') {
    if (prev.completionArmed && distFromGreen >= DEPARTURE_METRES) {
      return { phase: 'completed', greenEnteredAt: null, completionArmed: false };
    }
    // Left too quickly (false step) — drop back to playing without arming
    return { phase: 'playing', greenEnteredAt: null, completionArmed: false };
  }

  // ── At tee → playing ─────────────────────────────────────────────────────
  if (atTee) {
    if (prev.phase === 'playing') return prev;
    return { phase: 'playing', greenEnteredAt: null, completionArmed: false };
  }

  // ── Default: keep last phase (approach or playing) ───────────────────────
  const fallback: HolePhase = prev.phase === 'playing' ? 'playing' : 'approaching';
  if (prev.phase === fallback) return prev;
  return { phase: fallback, greenEnteredAt: null, completionArmed: false };
}
