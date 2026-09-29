/**
 * 2026-09-28 (1.0.2) — PROMO-GRANTED ACCESS ENDS WITH THE PROMO; A STORE SUBSCRIPTION NEVER DOES HERE.
 *
 * grantPromo / extendPromo (referral rewards, owner comps, the old 7-day extension) write 'active'.
 * When the promo expired, planTrialLifecycle cleared it and fell through to a ladder with no rung for
 * 'active' — so the player kept Pro for ever (the old test pinned exactly `{ clearPromo: true }`).
 *
 * The ladder cannot see the store, so the profile now carries the store's last answer
 * (store_entitlement_active, written on every launch read / purchase / restore). An 'active' the store
 * says it did NOT issue lapses to 'expired'. One the store vouches for — or has not answered on yet —
 * is never touched: a subscriber is never downgraded on a guess.
 */
import { planTrialLifecycle, type LifecycleInput } from '../../services/billing/trialLifecycle';
import { planEntitlementWrite, storeEntitledFromCustomerInfo, ENTITLEMENT_ID } from '../../services/billing/purchases';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 28);
const lapsedPromo: LifecycleInput = {
  subscriptionsEnabled: true,
  isOwner: false,
  status: 'active',
  promoExpiresAt: NOW - DAY,
  firstOpenedAt: NOW - 60 * DAY,
  trialStartedAt: null,
  trialDurationMs: 14 * DAY,
  now: NOW,
};

describe('when a promo ends', () => {
  it('THE BUG: promo-granted access lapses — the store says it issued nothing', () => {
    expect(planTrialLifecycle({ ...lapsedPromo, storeEntitled: false }))
      .toEqual({ clearPromo: true, setStatus: 'expired' });
  });

  it('a real store subscriber is NOT downgraded (a referral reward stacked on a paid plan)', () => {
    expect(planTrialLifecycle({ ...lapsedPromo, storeEntitled: true })).toEqual({ clearPromo: true });
  });

  it('before the store has answered on this install, nobody is downgraded on a guess', () => {
    expect(planTrialLifecycle({ ...lapsedPromo, storeEntitled: null })).toEqual({ clearPromo: true });
    expect(planTrialLifecycle({ ...lapsedPromo })).toEqual({ clearPromo: true });
  });

  it('a promo still running holds active, whatever the store says', () => {
    expect(planTrialLifecycle({ ...lapsedPromo, promoExpiresAt: NOW + DAY, storeEntitled: false })).toEqual({});
  });

  it('the owner keeps lifetime', () => {
    expect(planTrialLifecycle({ ...lapsedPromo, isOwner: true, status: 'lifetime', storeEntitled: false }))
      .toEqual({ clearPromo: true });
  });
});

describe('the store answer the rule reads', () => {
  const active = { entitlements: { active: { [ENTITLEMENT_ID]: { isActive: true, periodType: 'NORMAL' } }, all: {} } };
  const never = { entitlements: { active: {}, all: {} } };
  it('yes / no / could not ask', () => {
    expect(storeEntitledFromCustomerInfo(active)).toBe(true);
    expect(storeEntitledFromCustomerInfo(never)).toBe(false);
    expect(storeEntitledFromCustomerInfo(null)).toBeNull();
  });
});

describe('the launch read restores a subscriber a lapsed promo touched mid-flight', () => {
  it('a positive store answer is written even when it matches what was read before the await', () => {
    // before 'active' → lifecycle lapsed the promo to 'expired' during the await → store says active.
    expect(planEntitlementWrite({ before: 'active', mapped: 'active', now: 'expired', storeEntitled: true })).toBe('active');
  });
  it('an echo with no store knowledge is still not written over a grant (the 09-18 rule stands)', () => {
    expect(planEntitlementWrite({ before: 'free', mapped: 'free', now: 'trial', storeEntitled: false })).toBeNull();
    expect(planEntitlementWrite({ before: 'free', mapped: 'free', now: 'trial' })).toBeNull();
  });
});
