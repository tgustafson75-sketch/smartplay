/**
 * Handicap tiers — the single source of truth for skill-tier thresholds.
 *
 * CADDIE BRAIN LENS: the player's skill TIER is something the brain owns and
 * uses to modulate everything downstream — how much it computes, how it talks,
 * and (later) how deep it analyzes. `deriveTier()` is the brain's read of the
 * player's level; everything else references these constants instead of magic
 * numbers.
 *
 * This file is intentionally split into TWO sections:
 *   1. CANONICAL TIER SYSTEM — the new, app-wide skill bands the rest of the
 *      plan (compute budget, language register, CNS Phase 3/4) builds on.
 *   2. LEGACY OPERATIONAL THRESHOLDS — the previously-scattered magic numbers,
 *      centralized here at their EXACT current values so this is a behaviour-
 *      neutral refactor. Some don't line up with the canonical bands; B2 will
 *      reconcile them deliberately (with sign-off), now that they're visible.
 */

// ─── 1. CANONICAL TIER SYSTEM ────────────────────────────────────────────────

export type HandicapTier = 'elite' | 'low' | 'mid' | 'high';

/** Default handicap when none is set — matches playerProfileStore + every API
 *  default. Lands in the MID band, i.e. the mid-to-high experience by default. */
export const DEFAULT_HANDICAP = 18;
export const DEFAULT_TIER: HandicapTier = 'mid';

/** Inclusive upper bounds for each band (canonical):
 *   elite = scratch/plus (<= 0), low 1–9, mid 10–18, high 19+. */
export const TIER_BANDS = {
  elite: { maxHandicap: 0,  label: 'Scratch / Elite' },
  low:   { maxHandicap: 9,  label: 'Low handicap' },
  mid:   { maxHandicap: 18, label: 'Mid handicap' },
  high:  { maxHandicap: Infinity, label: 'High handicap' },
} as const;

/** The brain's read of the player's tier from their handicap. Null/unknown →
 *  DEFAULT_TIER (mid-to-high), never a crash. */
export function deriveTier(handicap: number | null | undefined): HandicapTier {
  const h = typeof handicap === 'number' && Number.isFinite(handicap) ? handicap : DEFAULT_HANDICAP;
  if (h <= TIER_BANDS.elite.maxHandicap) return 'elite';
  if (h <= TIER_BANDS.low.maxHandicap) return 'low';
  if (h <= TIER_BANDS.mid.maxHandicap) return 'mid';
  return 'high';
}

/** Map a tier onto the existing 3-level CoachingComplexity (we REUSE that enum
 *  rather than inventing a parallel one). This is the bridge the rest of the
 *  system will adopt in B2/B3. */
export function tierToComplexity(tier: HandicapTier): 'simple' | 'standard' | 'advanced' {
  switch (tier) {
    case 'high': return 'simple';
    case 'mid':  return 'standard';
    case 'low':
    case 'elite': return 'advanced';
  }
}

export const TIER_LABEL: Record<HandicapTier, string> = {
  elite: TIER_BANDS.elite.label,
  low: TIER_BANDS.low.label,
  mid: TIER_BANDS.mid.label,
  high: TIER_BANDS.high.label,
};

// ─── 2. LEGACY OPERATIONAL THRESHOLDS (values UNCHANGED — behaviour-neutral) ──
// These were scattered as magic numbers. Centralized here at their current
// values; B2 decides which to reconcile with the canonical bands above.

/** services/coachingAdaptation.ts — handicap at/below which coaching goes
 *  'advanced'. NOTE: 8, not the canonical low-band 9 — reconcile in B2. */
export const COMPLEXITY_ADVANCED_MAX_HCP = 8;

/** services/patternDetection.ts — handicap breaks for the strength label. */
export const STRENGTH_LABEL_BREAKS = { precision: 5, management: 10, fundamentals: 18 } as const;

/** app/smartfinder.tsx — handicap breaks for the dispersion-estimate bias
 *  curve (a 5-step yardage adjustment, NOT a skill tier). */
export const DISPERSION_HCP_BREAKS = { tight: 2, good: 8, neutral: 14, loose: 22 } as const;

/** api/swing-analysis.ts prompt — plain-language at/above, technical at/below.
 *  (Centralized for B2 when the analysis register work touches the prompt.) */
export const ANALYSIS_PROMPT_PLAIN_MIN_HCP = 20;
export const ANALYSIS_PROMPT_TECHNICAL_MAX_HCP = 10;
