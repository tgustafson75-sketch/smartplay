/**
 * ResponseFormatter — formats voice responses by style and personality.
 *
 * STYLE
 * ─────
 *   short    → terse, numbers only:  "145"
 *   neutral  → standard phrasing:    "145 yards"
 *   detailed → conversational:       "You've got 145 yards"
 *
 * PERSONALITY (affects tone of detailed + neutral responses)
 * ───────────
 *   calm       — measured, caddie-like
 *   aggressive — direct, high-energy
 *   coach      — instructional, process-focused
 *
 * USAGE
 * ─────
 *   import { formatDistance, formatClub, formatAdvice } from './ResponseFormatter';
 *
 *   const msg = formatDistance(145, 'neutral', 'calm');
 *   // → "145 yards"
 *
 * RULES
 * ─────
 *   • Pure functions — no state, no side-effects
 *   • Returns a non-empty string always
 *   • Keep short/neutral variants ≤ 5 words; detailed ≤ 12 words
 */

import type { ResponseMode }    from '../../store/settingsStore';
import type { FollowUpPersonality } from './FollowUpEngine';

export type { ResponseMode };
export type { FollowUpPersonality as ResponsePersonality };

// ─────────────────────────────────────────────────────────────────────────────
// Distance
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format the distance response.
 * @param yards  Numeric distance to the target. Null → "unavailable" phrase.
 */
export function formatDistance(
  yards:       number | null | undefined,
  style:       ResponseMode        = 'neutral',
  personality: FollowUpPersonality = 'calm',
): string {
  if (yards == null || yards <= 0) {
    if (style === 'short') return 'Unknown.';
    if (personality === 'coach') return 'No distance available. Pin location needed.';
    return 'Distance not available.';
  }

  if (style === 'short') return `${yards}.`;

  if (style === 'neutral') return `${yards} yards.`;

  // detailed — personality-aware
  if (personality === 'aggressive') return `${yards} yards. Pull the trigger.`;
  if (personality === 'coach')      return `You've got ${yards} yards. Pick a specific target.`;
  return `You've got ${yards} yards.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Club recommendation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format the club recommendation response.
 * @param club  Club name string, e.g. "7 iron". Null → fallback phrase.
 */
export function formatClub(
  club:        string | null | undefined,
  style:       ResponseMode        = 'neutral',
  personality: FollowUpPersonality = 'calm',
): string {
  if (!club) {
    if (style === 'short') return 'Unknown.';
    if (personality === 'coach') return 'No club data. Base it on your distance.';
    return 'Select a club based on your distance.';
  }

  if (style === 'short') return `${club}.`;

  if (style === 'neutral') {
    if (personality === 'aggressive') return `${club} — go.`;
    if (personality === 'coach')      return `${club} is the right number.`;
    return `I like the ${club}.`;
  }

  // detailed
  if (personality === 'aggressive') return `${club}. Step up and commit.`;
  if (personality === 'coach')      return `${club} here. Commit to a target and stay through it.`;
  return `I'd go with the ${club} here.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// General caddie advice
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format a caddie advice response.
 * @param advice  Full advice string from AI or fallback.
 */
export function formatAdvice(
  advice:      string | null | undefined,
  style:       ResponseMode        = 'neutral',
  personality: FollowUpPersonality = 'calm',
): string {
  const base = advice?.trim();

  if (!base) {
    if (personality === 'aggressive') return 'Stay aggressive. Center green.';
    if (personality === 'coach')      return 'Stay committed. Play center green and hold your finish.';
    return 'Stay committed and play center green.';
  }

  if (style === 'short') {
    // Truncate to first sentence for brevity
    const first = base.split(/[.!?]/)[0]?.trim();
    return first ? `${first}.` : base;
  }

  if (style === 'neutral') return base;

  // detailed — add personality framing
  if (personality === 'aggressive') return `${base} Trust it.`;
  if (personality === 'coach')      return `${base} Focus on process.`;
  return base;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shot logged confirmation
// ─────────────────────────────────────────────────────────────────────────────

export function formatShotLogged(
  style:       ResponseMode        = 'neutral',
  personality: FollowUpPersonality = 'calm',
): string {
  if (style === 'short') return 'Logged.';
  if (personality === 'aggressive') return 'Shot logged. Next.';
  if (personality === 'coach')      return 'Shot logged. Think about your next target.';
  return 'Shot logged.';
}
