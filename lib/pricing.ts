/**
 * Pre-beta pricing — single full-feature tier.
 *
 * One source of truth for every price string surfaced in the app and the
 * paywall. Adjust here and every consumer follows.
 *
 * TODO Phase 2B: align stripeProductId values with the real Stripe product
 * IDs created in the Stripe dashboard during the billing wire-up.
 */

export const PRICING = {
  monthly: {
    price: 9.99,
    displayPrice: '$9.99',
    period: 'month' as const,
    stripeProductId: 'TBD',
  },
  annual: {
    price: 79,
    displayPrice: '$79',
    period: 'year' as const,
    stripeProductId: 'TBD',
    savingsPct: 34,
  },
  trialDays: 7,
} as const;

export const PAYWALL_HEADLINE = 'Full Kevin. $9.99/month.';
export const PAYWALL_SUBHEAD = 'Or $79/year — save 34%.';
