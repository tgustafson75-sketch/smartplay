/**
 * 2026-09-29 (Tim — "we don't have to verify Vet status, pro shop will check the accuracy of the
 * pricing category") — THE TEE-TIME RATE CATEGORY, ONE OWNER.
 *
 * The player's profile holds it, the caddie hears it every turn, the find_tee_time tool takes it and
 * the pro-shop call script says it. Four readers of one fact, so the list and the words for it live
 * here and nowhere else. Pure — api/kevin imports it as well as the app.
 *
 * The app never checks eligibility. The course does, at the counter; everything that says a rate
 * out loud says it as "what to ask for", never as a price the player is owed.
 */

export const RATE_CATEGORIES = ['none', 'veteran_military', 'senior', 'junior', 'resident'] as const;
export type RateCategory = (typeof RATE_CATEGORIES)[number];

/** Anything that is not one of the five — a stale or hostile persisted value, a model's guess — is 'none'. */
export function normalizeRateCategory(v: unknown): RateCategory {
  return typeof v === 'string' && (RATE_CATEGORIES as readonly string[]).includes(v) ? (v as RateCategory) : 'none';
}

/** What to ask the pro shop for, in words. null for 'none' — there is nothing to ask for. */
export function rateCategoryPhrase(v: unknown): string | null {
  switch (normalizeRateCategory(v)) {
    case 'veteran_military': return 'veteran/military rate';
    case 'senior': return 'senior rate';
    case 'junior': return 'junior rate';
    case 'resident': return 'resident rate';
    default: return null;
  }
}
