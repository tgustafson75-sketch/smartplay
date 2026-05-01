/**
 * Mode selector — chooses Kevin's register (Caddie / Coach / Psychologist) for a
 * given moment using internal signals (routine timing, score situation, recent shot
 * quality, surface context).
 *
 * This module is a stub. The framework is in place so future Caddie / Coach /
 * Psychologist prompt templates can call `selectMode(signals)` before composing a
 * response, but the live decision logic is intentionally not yet wired into any
 * runtime path. Today every surface still uses its existing prompts directly.
 *
 * When register-shifting comes online (separate phase), the orchestrators that
 * currently call `speak()` or compose Kevin prompts will route through
 * `selectMode()` to pick the right voice for the moment.
 */

import { CADDIE_ROLE_ID } from './roles/caddieRole';
import { COACH_ROLE_ID } from './roles/coachRole';
import { PSYCHOLOGIST_ROLE_ID } from './roles/psychologistRole';
import { getTrustLevel, psychologistEnabled } from './trustLevelService';

export type RoleId =
  | typeof CADDIE_ROLE_ID
  | typeof COACH_ROLE_ID
  | typeof PSYCHOLOGIST_ROLE_ID;

/**
 * Signals the selector reads. Each is optional — the selector copes with
 * partial information by falling back to the surface hint.
 */
export interface ModeSignals {
  /** What surface is the user on right now ('round' | 'recap' | 'home' | etc.). */
  surface_hint?: 'round' | 'recap' | 'home' | 'plan' | 'settings' | string;
  /** Seconds since the player's last shot. */
  seconds_since_last_shot?: number | null;
  /** Most recent shot outcome ('good' | 'bad' | 'neutral' | null). */
  last_shot_outcome?: 'good' | 'bad' | 'neutral' | null;
  /** Score-vs-par at this moment (used as a stress proxy). */
  score_vs_par?: number | null;
  /** Whether the user just spoke (vs. silence between shots). */
  user_just_spoke?: boolean;
  /** Whether the user just finished a round. */
  round_just_ended?: boolean;
}

/**
 * Surface-driven default mapping, gated by Trust Spectrum level (Phase E).
 *
 * recap / round-just-ended → Coach
 * mid-round silence (walking conversation) → Psychologist if trust level allows
 * everything else → Caddie
 *
 * Trust-level gating:
 *   L1 Quiet      — Psychologist register dormant. Walking-conversation silence
 *                   is interpreted as the player wants quiet — falls back to Caddie.
 *   L2 Companion  — Psychologist register dormant for default. Same fallback.
 *   L3 Active     — Walking-conversation triggers fire. Psychologist active in silence.
 *   L4 Full       — Walking-conversation triggers fire and additionally character-breadth
 *                   conversation is permitted (consumed by future prompt templates).
 */
export function selectMode(signals: ModeSignals): RoleId {
  if (signals.surface_hint === 'recap' || signals.round_just_ended) {
    return COACH_ROLE_ID;
  }

  if (
    signals.surface_hint === 'round' &&
    !signals.user_just_spoke &&
    signals.seconds_since_last_shot != null &&
    signals.seconds_since_last_shot > 60 &&
    psychologistEnabled()
  ) {
    return PSYCHOLOGIST_ROLE_ID;
  }

  return CADDIE_ROLE_ID;
}

/**
 * Convenience for callers that want the trust level alongside the chosen role
 * (e.g. prompt templates that adjust verbosity by level).
 */
export function selectModeWithLevel(signals: ModeSignals): { role: RoleId; level: 1 | 2 | 3 | 4 } {
  return { role: selectMode(signals), level: getTrustLevel() };
}

/** Stable identifier list for documentation and registration sites. */
export const ROLE_IDS = [CADDIE_ROLE_ID, COACH_ROLE_ID, PSYCHOLOGIST_ROLE_ID] as const;
