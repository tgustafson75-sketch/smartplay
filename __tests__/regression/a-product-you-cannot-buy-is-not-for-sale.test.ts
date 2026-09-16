/**
 * 2026-09-15 — App Review, guideline 2.1(b): "we cannot locate the In-App Purchases, such as
 * 'SmartPlay Caddie Full — Monthly' and 'SmartPlay Caddie Full — Annual', within the app."
 *
 * They were right about both, for two unrelated reasons, and this file guards the one that lives
 * in a pure function. The ANNUAL product was quoted on the paywall — its price, its period, its
 * 34% saving, and the voice line spoke it aloud — and nothing in the app ever asked the store for
 * it. `handleSubscribe` hardcoded the MONTHLY package. A reviewer hunting for two products could
 * only ever have found one, because only one was ever on sale.
 *
 * (The other reason — no reachable route to the paywall at all during a trial — is guarded by
 * `a-paywall-only-a-locked-out-player-can-reach.test.tsx`, which needs a renderer.)
 *
 * The positional fallback is the second half of this. The old line ended `?? packages[0]` under a
 * comment that already called it "not a fallback, it is a wrong charge". It was survivable while
 * the screen sold exactly one thing and the player had chosen nothing; the moment there is a
 * selector, falling back means billing someone for the plan they just declined.
 */

import { selectPackageForPlan } from '../../services/billing/purchases';
import { PRICING } from '../../lib/pricing';

const pkg = (packageType: string, identifier: string) => ({
  packageType,
  product: { identifier },
});

// The shape App Store Connect / RevenueCat actually return, with lifetime listed FIRST — the
// ordering that made `packages[0]` a wrong charge waiting to happen.
const OFFERING = [
  pkg('LIFETIME', 'com.smartplaycaddie.app.full.lifetime'),
  pkg('MONTHLY', PRICING.monthly.productId),
  pkg('ANNUAL', PRICING.annual.productId),
];

describe('both products the store lists are actually purchasable', () => {
  it('finds the annual package when the player picked annual', () => {
    const chosen = selectPackageForPlan(OFFERING, 'annual') as { product: { identifier: string } };
    expect(chosen).toBeTruthy();
    expect(chosen.product.identifier).toBe(PRICING.annual.productId);
  });

  it('finds the monthly package when the player picked monthly', () => {
    const chosen = selectPackageForPlan(OFFERING, 'monthly') as { product: { identifier: string } };
    expect(chosen).toBeTruthy();
    expect(chosen.product.identifier).toBe(PRICING.monthly.productId);
  });

  it('never returns the other plan — a wrong charge is worse than no charge', () => {
    // RevenueCat's Test Store names its products `monthly` / `yearly` and carries no packageType
    // this code would recognise. Pre-2026-08-30 this matched nothing and fell through to
    // packages[0] — here, the lifetime product.
    const testStore = [
      { product: { identifier: 'lifetime' } },
      { product: { identifier: 'monthly' } },
      { product: { identifier: 'yearly' } },
    ];
    expect(selectPackageForPlan(testStore, 'annual')).toBeNull();
    expect(selectPackageForPlan(testStore, 'monthly')).toBeNull();
  });

  it('returns null rather than guessing when the offering is empty', () => {
    expect(selectPackageForPlan([], 'monthly')).toBeNull();
    expect(selectPackageForPlan([], 'annual')).toBeNull();
  });

  it('matches on product id when the offering carries no packageType', () => {
    const idsOnly = [
      { product: { identifier: PRICING.monthly.productId } },
      { product: { identifier: PRICING.annual.productId } },
    ];
    const annual = selectPackageForPlan(idsOnly, 'annual') as { product: { identifier: string } };
    expect(annual.product.identifier).toBe(PRICING.annual.productId);
  });

  it('the two products have distinct ids — one id would make the selector meaningless', () => {
    expect(PRICING.monthly.productId).not.toBe(PRICING.annual.productId);
  });
});
