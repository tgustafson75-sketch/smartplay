/**
 * engine/personalityEngine.ts
 *
 * Caddie Personality Engine — adapts response tone based on round state
 * and player preference without making personality changes jarring or gimmicky.
 *
 * Modes:
 *   calm        — measured, steady; default
 *   confident   — positive, slightly assertive; triggered by good momentum
 *   competitive — direct, brief extra push; player-selected only
 *
 * Design rules:
 *   • Auto-adjustments are subtle (mode only, not verbosity)
 *   • Player overrides are respected and preserved across auto-adjustments
 *   • No long motivational speeches — max one appended word / phrase
 *   • Text modifications are minimal string tweaks, not rewrites
 */

import type { RoundState } from './roundEngine';

// ─── Types ────────────────────────────────────────────────────────────────────

export type PersonalityMode     = 'calm' | 'confident' | 'competitive';
export type PersonalityVerbosity = 'short' | 'medium';

export interface PersonalityProfile {
  mode:      PersonalityMode;
  verbosity: PersonalityVerbosity;
  /**
   * When true the player has manually set the mode and auto-adjust
   * will only move the mode toward calm (never override toward confident).
   */
  playerOverride: boolean;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export const createPersonalityProfile = (
  mode: PersonalityMode = 'calm',
): PersonalityProfile => ({
  mode,
  verbosity:      'short',
  playerOverride: false,
});

// ─── Auto-adjust ──────────────────────────────────────────────────────────────

/**
 * Nudge personality based on round momentum.
 * Respects player overrides: never escalates past what the player set.
 * Changes are one-step only — calm → confident, never calm → competitive.
 */
export const updatePersonality = (
  personality: PersonalityProfile,
  roundState:  RoundState | null,
): PersonalityProfile => {
  if (!roundState) return personality;

  // Negative momentum → always pull back to calm (override-safe)
  if (roundState.momentum === 'negative') {
    if (personality.mode !== 'calm') {
      return { ...personality, mode: 'calm' };
    }
    return personality;
  }

  // Positive momentum → step up to confident only when not already higher
  if (roundState.momentum === 'positive') {
    // Don't override a player-set competitive mode
    if (personality.mode === 'calm') {
      return { ...personality, mode: 'confident' };
    }
  }

  return personality;
};

// ─── Player override ──────────────────────────────────────────────────────────

export const setPlayerPersonality = (
  personality: PersonalityProfile,
  mode: PersonalityMode,
): PersonalityProfile => ({
  ...personality,
  mode,
  playerOverride: true,
});

// ─── Apply to message ─────────────────────────────────────────────────────────

/**
 * Apply personality mode to an already-formatted caddie message.
 * Keeps modifications minimal — at most one word or short phrase.
 */
export const applyPersonality = (
  message: string,
  personality: PersonalityProfile,
): string => {
  const msg = message.trim();

  switch (personality.mode) {
    case 'confident':
      // Elevate hedging language only — don't touch messages that are already direct
      return msg
        .replace(/\bfits here\b/gi, 'is the play')
        .replace(/\bI like the\b/gi, 'Hit the')
        .replace(/\bworks here\b/gi, 'is the call');

    case 'competitive':
      // Append a brief push only when the message doesn't already end with one
      if (!/\bgo\b\.?$|commit\.?$|trust it\.?$/i.test(msg)) {
        return `${msg} Let's go.`;
      }
      return msg;

    case 'calm':
    default:
      return msg;
  }
};
