/**
 * 2026-09-28 (1.0.2) — THE TRIAL THE PAYWALL DESCRIBES IS THE ONE THE STORE WILL GIVE.
 *
 * The paywall said "14-day free trial" and the caddie said "14 days on me", read from a constant in
 * lib/pricing.ts — while the only trial that now exists is the store's introductory offer, configured
 * in App Store Connect and Play Console, and only for players the store says are eligible. A constant
 * cannot know either of those things. So the wording is derived from the package the player would buy,
 * and when there is no offer (or the player is not eligible) there is no trial wording at all.
 *
 * Pure: the RevenueCat shapes are read loosely (unknown in, a small value out) so it can be table-tested
 * without the SDK.
 */

export type TrialUnit = 'day' | 'week' | 'month' | 'year';
export type FreeTrial = { count: number; unit: TrialUnit };

/** What the store said about intro-offer eligibility for this product. */
export type IntroEligibility = 'eligible' | 'ineligible' | 'unknown' | 'none';

const UNIT: Record<string, TrialUnit> = { DAY: 'day', WEEK: 'week', MONTH: 'month', YEAR: 'year' };

/**
 * The free trial a package would start, or null.
 *
 * - iOS: `product.introPrice` with a price of 0 is a free trial; its length is cycles × units. Apple
 *   only honours it for an eligible player, and RevenueCat's own guidance for UNKNOWN is to show the
 *   non-intro price — so iOS requires `eligible`.
 * - Google Play: the free phase of the product's default option. Play returns only offers the player
 *   is eligible for, and RevenueCat reports Android eligibility as UNKNOWN always, so the phase being
 *   present is the eligibility answer; only an explicit `ineligible`/`none` suppresses it.
 */
export function freeTrialFromPackage(pkg: unknown, platform: 'ios' | 'android' | string, eligibility: IntroEligibility): FreeTrial | null {
  const product = (pkg as { product?: Record<string, unknown> } | null)?.product;
  if (!product) return null;
  if (eligibility === 'ineligible' || eligibility === 'none') return null;

  if (platform === 'android') {
    const phase = (product.defaultOption as { freePhase?: { billingPeriod?: { unit?: string; value?: number } } } | null | undefined)?.freePhase;
    const unit = UNIT[String(phase?.billingPeriod?.unit ?? '').toUpperCase()];
    const count = Number(phase?.billingPeriod?.value);
    if (unit && Number.isFinite(count) && count > 0) return { count, unit };
    // Fall through: some Play products surface the trial only as introPrice.
  } else if (eligibility !== 'eligible') {
    return null;
  }

  const intro = product.introPrice as { price?: number; cycles?: number; periodUnit?: string; periodNumberOfUnits?: number } | null | undefined;
  if (!intro || Number(intro.price) !== 0) return null;
  const unit = UNIT[String(intro.periodUnit ?? '').toUpperCase()];
  const count = Math.max(1, Number(intro.cycles) || 1) * Number(intro.periodNumberOfUnits);
  if (!unit || !Number.isFinite(count) || count <= 0) return null;
  return { count, unit };
}

/** "1-month", "7-day", "2-week" — the adjective form, for "a 1-month free trial". */
export function trialAdjective(t: FreeTrial): string {
  return `${t.count}-${t.unit}`;
}

/** "1 month", "7 days", "2 weeks" — the noun form, for "free for 1 month". */
export function trialDuration(t: FreeTrial): string {
  return `${t.count} ${t.unit}${t.count === 1 ? '' : 's'}`;
}

/** The caddie's spoken tail: "The first month is on me." / "The first 7 days are on me." */
export function trialSpokenLine(t: FreeTrial): string {
  return t.count === 1 ? `The first ${t.unit} is on me.` : `The first ${trialDuration(t)} are on me.`;
}
