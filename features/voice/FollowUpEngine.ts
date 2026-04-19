/**
 * FollowUpEngine — generates a short, context-aware follow-up to a voice response.
 *
 * Design rules:
 *   • Pure function — no state, no side-effects, always synchronous
 *   • Returns at most ONE follow-up string, or null
 *   • Follow-up must add value — never repeat info already in the main response
 *   • Keep phrases ≤ 8 words (fast ElevenLabs delivery, no overload)
 *
 * Integration:
 *   Call getFollowUp() after building the main response.
 *   Speak main immediately, speak follow-up after ~800 ms.
 *
 * Usage:
 *   const follow = getFollowUp({ intent, context, personality });
 *   speak(main);
 *   if (follow) setTimeout(() => speak(follow), 800);
 */

import type { CommandKey }    from './CommandEngine';
import type { WindState }     from '../../features/smartCaddie/engine/WindEngine';
import type { ElevationState } from '../../features/smartCaddie/engine/ElevationEngine';

// ─────────────────────────────────────────────────────────────────────────────
// Context
// ─────────────────────────────────────────────────────────────────────────────

export interface HazardInfo {
  /** Label shown on map — 'Water', 'Bunker', 'OB' */
  label:  string;
  /** Type string */
  type:   'water' | 'bunker' | 'ob' | string;
  /** Yards to carry the front edge of the hazard */
  carry:  number;
  /** Yards to fully clear the hazard */
  clear:  number;
}

export interface FollowUpContext {
  /** Wind state from caddie screen */
  wind?:              WindState | null;
  /** Elevation state */
  elevation?:         ElevationState | null;
  /** Adjusted "plays like" distance in yards */
  effectiveDistance?: number | null;
  /** Raw GPS / target distance */
  baseDistance?:      number | null;
  /** Net yards of the combined adjustment (positive = plays longer) */
  adjustmentDelta?:   number | null;
  /** Hazard(s) on the shot line (from LineProjection) */
  hazards?:           HazardInfo[];
  /** Player's common miss direction */
  missPattern?:       'left' | 'right' | null;
  /** Current hole number */
  currentHole?:       number;
  /** Par of current hole */
  par?:               number;
}

export type FollowUpPersonality = 'calm' | 'aggressive' | 'coach';

export interface FollowUpInput {
  intent:      CommandKey;
  context:     FollowUpContext;
  personality?: FollowUpPersonality;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/** True when the wind meaningfully changes the playing distance */
function hasSignificantWind(ctx: FollowUpContext): boolean {
  if (!ctx.wind || ctx.wind.direction === 'left' || ctx.wind.direction === 'right') return false;
  return ctx.wind.speed >= 5 && ctx.adjustmentDelta != null && Math.abs(ctx.adjustmentDelta) >= 5;
}

/** True when elevation meaningfully changes the playing distance */
function hasSignificantElevation(ctx: FollowUpContext): boolean {
  if (!ctx.elevation || ctx.elevation === 'flat') return false;
  return ctx.adjustmentDelta != null && Math.abs(ctx.adjustmentDelta) >= 5;
}

/** True when the shot line passes a hazard */
function hasPrimaryHazard(ctx: FollowUpContext): boolean {
  return (ctx.hazards?.length ?? 0) > 0;
}

/** Phrase for plays-like distance — personality-aware */
function playsLikePhrase(dist: number, delta: number, personality: FollowUpPersonality): string {
  const dir = delta > 0 ? 'into wind' : 'downwind';
  if (personality === 'aggressive') {
    return delta > 0
      ? `Plays like ${dist} — commit.`
      : `Plays short — fire at it.`;
  }
  if (personality === 'coach') {
    return `Effective distance is ${dist} yards ${dir}.`;
  }
  // calm (default)
  return `Plays like ${dist}.`;
}

/** Phrase for a hazard carry warning — uses the nearest hazard */
function hazardPhrase(hazards: HazardInfo[], personality: FollowUpPersonality): string {
  const h = hazards[0];
  const name = h.type === 'water' ? 'Water' : h.type === 'ob' ? 'OB' : 'Bunker';
  if (personality === 'aggressive') return `Carry the ${name.toLowerCase()} at ${h.carry}.`;
  if (personality === 'coach')      return `${name} at ${h.carry} — you need ${h.clear} to clear.`;
  return `Carry ${name.toLowerCase()} at ${h.carry}.`;
}

/** Phrase for crosswind lateral effect */
function crosswindPhrase(wind: WindState, personality: FollowUpPersonality): string {
  const side = wind.direction === 'left' ? 'right' : 'left';
  if (personality === 'aggressive') return `Shape it — wind pushes ${side}.`;
  if (personality === 'coach')      return `Crosswind — aim slightly ${side}.`;
  return `Aim a touch ${side}.`;
}

/** Miss-pattern reminder */
function missPhrase(miss: 'left' | 'right', personality: FollowUpPersonality): string {
  const safe = miss === 'right' ? 'left' : 'right';
  if (personality === 'aggressive') return `Stay ${safe}—your miss is ${miss}.`;
  if (personality === 'coach')      return `You tend ${miss}. Favor the ${safe} side.`;
  return `Favor ${safe}.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a single short follow-up phrase for a voice intent + game context.
 *
 * Returns null when nothing meaningful can be added, ensuring the response stays
 * clean and non-repetitive.
 *
 * Priority order (first applicable wins):
 *   1. Hazard on shot line          → carry warning
 *   2. Significant wind/elevation   → plays-like distance
 *   3. Crosswind                    → aim direction
 *   4. Miss pattern (GET_CLUB only) → aim reminder
 */
export function getFollowUp({ intent, context: ctx, personality = 'calm' }: FollowUpInput): string | null {
  // ── GET_CLUB ──────────────────────────────────────────────────────────────
  if (intent === 'GET_CLUB') {
    // 1. Hazard on line → carry is the most actionable info
    if (hasPrimaryHazard(ctx) && ctx.hazards!.length > 0) {
      return hazardPhrase(ctx.hazards!, personality);
    }
    // 2. Plays-like when wind/elevation is significant
    if ((hasSignificantWind(ctx) || hasSignificantElevation(ctx)) && ctx.effectiveDistance != null) {
      return playsLikePhrase(ctx.effectiveDistance, ctx.adjustmentDelta ?? 0, personality);
    }
    // 3. Crosswind — no distance change but affects aim
    if (ctx.wind && (ctx.wind.direction === 'left' || ctx.wind.direction === 'right') && ctx.wind.speed >= 8) {
      return crosswindPhrase(ctx.wind, personality);
    }
    // 4. Miss pattern — remind aim
    if (ctx.missPattern) {
      return missPhrase(ctx.missPattern, personality);
    }
    return null;
  }

  // ── GET_DISTANCE ──────────────────────────────────────────────────────────
  if (intent === 'GET_DISTANCE') {
    // Plays-like is the primary add-on for a distance query
    if ((hasSignificantWind(ctx) || hasSignificantElevation(ctx)) && ctx.effectiveDistance != null) {
      return playsLikePhrase(ctx.effectiveDistance, ctx.adjustmentDelta ?? 0, personality);
    }
    // Hazard distances add useful context here too
    if (hasPrimaryHazard(ctx) && ctx.hazards!.length > 0) {
      return hazardPhrase(ctx.hazards!, personality);
    }
    return null;
  }

  // ── GET_ADVICE ────────────────────────────────────────────────────────────
  if (intent === 'GET_ADVICE') {
    // Hazard is the most important thing to flag in a general advice response
    if (hasPrimaryHazard(ctx) && ctx.hazards!.length > 0) {
      return hazardPhrase(ctx.hazards!, personality);
    }
    if (ctx.missPattern) {
      return missPhrase(ctx.missPattern, personality);
    }
    return null;
  }

  // ── NEXT_HOLE / PREV_HOLE — no follow-up useful ───────────────────────────
  // ── LOG_SHOT / RECORD_SHOT — confirmation only, no follow-up ─────────────
  return null;
}
