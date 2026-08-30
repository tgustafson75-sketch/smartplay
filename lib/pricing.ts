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
