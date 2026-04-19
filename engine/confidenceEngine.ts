/**
 * engine/confidenceEngine.ts
 *
 * Decision Confidence Layer for Focus Mode.
 *
 * Distinct from features/smartCaddie/engine/ConfidenceEngine (which measures
 * player confidence from shot history).  This module measures how *certain the
 * caddie should sound* about a recommendation, based on the full FocusContext:
 * distance, round momentum, memory data quality, and learning confidence.
 *
 * Design rules:
 *   • Language shifts are minimal — one word or prepended clause at most
 *   • No numeric scores are surfaced to the player
 *   • "high" replaces hedging language; "low" adds a calming prefix only
 *   • Never stacks with applyTone or applyPersonality — caller decides order
 */

import type { FocusContext } from './contextBuilder';
import { getClubConfidence } from './learningEngine';

// ─── Types ────────────────────────────────────────────────────────────────────

export type DecisionConfidence = 'high' | 'medium' | 'low';

// ─── Confidence scoring ───────────────────────────────────────────────────────

/**
 * Returns how confident the caddie should sound about this recommendation.
 *
 * Priority order (first match wins):
 *   1. Negative round momentum           → low   (player is off-track)
 *   2. Positive round momentum           → high  (player is in a rhythm)
 *   3. Short-distance shot (<140 yds)    → high  (high-control club, clearer call)
 *   4. Club confidence from learning     → mirrors learning signal
 *   5. Default                           → medium
 */
export const getDecisionConfidence = (
  context: FocusContext,
  club?: string | null,
): DecisionConfidence => {
  const { distance, memory, roundState } = context;

  if (roundState?.momentum === 'negative') return 'low';
  if (roundState?.momentum === 'positive') return 'high';

  if (distance != null && distance < 140) return 'high';

  // Fall back to per-club learning signal when available
  if (club && memory) {
    const clubConf = getClubConfidence(memory, club);
    if (clubConf === 'high') return 'high';
    if (clubConf === 'low')  return 'low';
  }

  return 'medium';
};

// ─── Language application ─────────────────────────────────────────────────────

/**
 * Subtly shifts message language to reflect caddie certainty.
 *
 *   high   — replaces common hedging phrases with assertive equivalents
 *   low    — prepends "Let's keep this simple." once (idempotent)
 *   medium — no change
 */
export const applyConfidence = (
  message:    string,
  confidence: DecisionConfidence,
): string => {
  const msg = message.trim();

  switch (confidence) {
    case 'high':
      return msg
        .replace(/\bfits here\b/gi,  'is the play')
        .replace(/\bworks here\b/gi, 'is the call')
        .replace(/\bI like the\b/gi, 'Hit the')
        .replace(/\bfits\b/gi,       'is perfect');

    case 'low':
      if (msg.startsWith("Let's keep this simple.")) return msg;
      return `Let's keep this simple. ${msg}`;

    case 'medium':
    default:
      return msg;
  }
};
