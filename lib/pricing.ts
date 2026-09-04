/**
 * Pricing — single full-feature tier.
 *
 * ONE SOURCE OF TRUTH for every price string surfaced in the app, and for the trial length. Adjust
 * here and every consumer follows — including services/featureAccess.trialDaysLeft, which used to
 * carry its own hardcoded 7 while this file said 14 and the paywall promised 14.
 *
 * 2026-08-29 — `stripeProductId` is gone. In-app digital subscriptions are handled by the App Store
 * and Google Play (guideline 3.1.1); Stripe inside the app is a rejection. The identifiers below are
 * the STORE product ids, and they live next to the prices deliberately: the number on the paywall
 * and the number in App Store Connect must be the same number, and keeping them in one file is the
 * only way anyone notices when they stop being. [[billing-stripe-vs-iap-constraint]]
 *
 * These strings must match what Cowork creates in App Store Connect and Play Console exactly.
 * [[cowork-task-list]]
 */

export const PRICING = {
  monthly: {
    price: 9.99,
    displayPrice: '$9.99',
    period: 'month' as const,
    productId: 'com.smartplaycaddie.app.full.monthly',
  },
  /**
   * 2026-09-05 (Tim) — $79 IS A FOUNDING PRICE, NOT THE STANDING ONE. It rises to $99.
   *
   * The unit economics say annual is the only exposed plan. $79 nets $5.60/month after the stores'
   * 15%; a heavy player costs about $10.08/month to serve, so every obsessive on annual loses about
   * $4.48/month — and annual SELECTS for exactly those people, because the golfers who commit for a
   * year are the ones who play the most. Monthly at $9.99 nets $8.49 against roughly $4.00 and is
   * healthy; it needs no protecting.
   *
   * TRIGGER — raise to $99 at whichever comes first:
   *   • 250 paying ANNUAL subscribers (not installs, not total subscribers), or
   *   • annual exceeding ~40% of new subscriptions.
   *
   * Why 250 rather than a round 50: the liability is trivial until it is not — roughly $34/month of
   * exposure at 50 annual subs, $170 at 250, and only material near 5,000. Cost is therefore not the
   * binding constraint at this scale; INFORMATION is. Fifty subscribers cannot tell you a conversion
   * rate, and conversion decides everything else. The 40% tripwire overrides the count, because that
   * is the signal that heavy users are self-selecting into the worst-priced plan and waiting would
   * just collect more of the wrong ones.
   *
   * AND THE PRICE IS THE SMALLER HALF. At $99 an obsessive still loses ~$3.07/month. What actually
   * makes annual viable at any price is cutting the two dominant costs — synthesised speech (71% of
   * a round) and club-path on Sonnet (59% of a swing). With both, a heavy player drops from ~$10.08
   * to ~$6.03/month, and $99 turns positive. See docs/POST-LAUNCH-ECONOMICS.md.
   *
   * Changing `price` and `displayPrice` here is NOT the whole change: the store products must be
   * repriced in App Store Connect and Play Console to match, and raising an EXISTING subscriber's
   * price is a separate action in both stores with its own consent flow. Existing subscribers keep
   * $79 by default, which is the intent — the founding cohort grandfathers itself.
   */
  annual: {
    price: 79,
    displayPrice: '$79',
    period: 'year' as const,
    productId: 'com.smartplaycaddie.app.full.annual',
    savingsPct: 34,
  },
  trialDays: 14,
} as const;

/**
 * 2026-08-29 — was the literal 'Full Kevin. $9.99/month.', on a screen that already resolves the
 * player's actual caddie two lines above and speaks their name aloud. A Serena player heard "Full
 * Serena…" and read a headline about Kevin. The app has four caddies and Serena is the default for
 * half the players. [[feels-like-a-real-caddie]]
 */
export function paywallHeadline(caddieName: string): string {
  return `Full ${caddieName}. ${PRICING.monthly.displayPrice}/month.`;
}
export const PAYWALL_SUBHEAD = `Or ${PRICING.annual.displayPrice}/year — save ${PRICING.annual.savingsPct}%.`;
