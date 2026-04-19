/**
 * engine/learningEngine.ts
 *
 * Adaptive Learning Loop — tracks per-club shot outcomes and produces
 * a confidence signal that shifts caddie advice over time.
 *
 * All functions are pure (no React, no storage).
 * CaddieContext is responsible for persisting the updated MemoryProfile.
 *
 * Design rules:
 *   • Confidence feedback is earned — minimum sample size enforced
 *   • Messages are short and neutral in tone ("been hitting this well")
 *   • High-confidence positive feedback only; low-confidence is advisory, not critical
 *   • Performance history is capped per club to stay lightweight
 */

import type { MemoryProfile } from './memoryEngine';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Max stored results per club — older entries are dropped */
const PERFORMANCE_CAP = 15;
/** Minimum results before confidence is anything other than 'neutral' */
const MIN_SAMPLES = 4;

// ─── Types ────────────────────────────────────────────────────────────────────

export type ShotResult  = 'straight' | 'left' | 'right';
export type Confidence  = 'high' | 'neutral' | 'low';

// ─── Club performance ─────────────────────────────────────────────────────────

/**
 * Append a shot result for a club.
 * Returns a new MemoryProfile with the updated clubPerformance map.
 */
export const updateClubPerformance = (
  memory: MemoryProfile,
  club:   string,
  result: ShotResult,
): MemoryProfile => {
  const history = memory.clubPerformance?.[club] ?? [];
  const updated = [...history, result].slice(-PERFORMANCE_CAP);

  return {
    ...memory,
    clubPerformance: {
      ...memory.clubPerformance,
      [club]: updated,
    },
  };
};

// ─── Confidence scoring ───────────────────────────────────────────────────────

/**
 * Return a confidence rating for how well the player hits a specific club.
 *
 *   high    — ≥70 % straight shots (min 4 samples)
 *   low     — <40 % straight shots (min 4 samples)
 *   neutral — insufficient data or mixed results
 */
export const getClubConfidence = (
  memory: MemoryProfile,
  club:   string,
): Confidence => {
  const history = memory.clubPerformance?.[club] ?? [];

  if (history.length < MIN_SAMPLES) return 'neutral';

  const straight = history.filter((r) => r === 'straight').length;
  const ratio    = straight / history.length;

  if (ratio >= 0.7) return 'high';
  if (ratio <  0.4) return 'low';
  return 'neutral';
};

// ─── Insight helper ───────────────────────────────────────────────────────────

/**
 * Returns a short insight string for the confidence level, or null when neutral.
 * Intended to be used as the `insight` slot in formatCaddieResponse — one clause only.
 */
export const getConfidenceInsight = (confidence: Confidence): string | null => {
  if (confidence === 'high') return "You've been hitting this well.";
  if (confidence === 'low')  return "This club's been inconsistent today — commit to the shot.";
  return null;
};
