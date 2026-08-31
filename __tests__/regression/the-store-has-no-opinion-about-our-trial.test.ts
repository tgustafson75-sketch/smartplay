/**
 * 2026-08-30 (full audit) — A STORE READ MUST NOT DESTROY A STATUS THE STORE DOES NOT ISSUE.
 *
 * RevenueCat hands a player who has never bought anything `entitlements: { active: {}, all: {} }` —
 * PRESENT, so the `!info?.entitlements` guard at the top of statusFromCustomerInfo does not fire,
 * and EMPTY, so nothing below it matched. The function then returned 'free'.
 *
 * For a player six days into OUR OWN 14-day trial, that is a demotion. planTrialLifecycle matches
 * no rung for them afterwards — its trial rung requires `!trialStartedAt` and theirs is set — so
 * they stay 'free', resolve to the 'lite' edition, and lose the caddie IN THE MIDDLE of a trial
 * they were told they had. The launch-day flip would have done it to everyone at once.
 *
 * It took comps with it too: grantPromo writes 'active' locally, and refreshEntitlement is async,
 * so it lands AFTER the sync lifecycle effect that granted it.
 *
 * The rule: the store is authoritative about what the STORE issued. Where it has never heard of
 * this player it has no opinion, and silence is not a downgrade.
 */

import { statusFromCustomerInfo } from '../../services/billing/purchases';
import { planTrialLifecycle } from '../../services/billing/trialLifecycle';

const ENT = 'smartplay_caddie_pro';
/** Exactly what RevenueCat returns for someone who has never purchased. */
const NEVER_PURCHASED = { entitlements: { active: {}, all: {} } };

describe('silence from the store is not a downgrade', () => {
  it('leaves our own trial alone', () => {
    // THE REGRESSION: this returned 'free'.
    expect(statusFromCustomerInfo(NEVER_PURCHASED, 'trial')).toBe('trial');
  });

  it('leaves a comp alone', () => {
    // grantPromo writes 'active' with no store purchase behind it.
    expect(statusFromCustomerInfo(NEVER_PURCHASED, 'active')).toBe('active');
  });

  it('still leaves an owner grant alone', () => {
    expect(statusFromCustomerInfo(NEVER_PURCHASED, 'lifetime')).toBe('lifetime');
  });

  it('does not invent a status for someone who has none', () => {
    expect(statusFromCustomerInfo(NEVER_PURCHASED, 'free')).toBe('free');
  });
});

describe('the store still wins where it HAS an opinion', () => {
  it('reports an active paid subscription', () => {
    const paid = { entitlements: { active: { [ENT]: { isActive: true, periodType: 'NORMAL' } }, all: { [ENT]: {} } } };
    expect(statusFromCustomerInfo(paid, 'free')).toBe('active');
  });

  it('reports a store-run trial as a trial, not as paid', () => {
    const storeTrial = { entitlements: { active: { [ENT]: { isActive: true, periodType: 'trial' } }, all: { [ENT]: {} } } };
    // Compared case-insensitively on purpose, so an SDK casing change cannot turn every trial paid.
    expect(statusFromCustomerInfo(storeTrial, 'free')).toBe('trial');
  });

  it('expires a subscription it has seen before and no longer sees as active', () => {
    // Refunds, cancellations and lapses all land here: RevenueCat keeps the entitlement in `all`
    // once it has ever been issued, so a real downgrade is still a downgrade.
    const lapsed = { entitlements: { active: {}, all: { [ENT]: {} } } };
    expect(statusFromCustomerInfo(lapsed, 'active')).toBe('expired');
    // And it overrides a local trial, because now the store DOES have an opinion.
    expect(statusFromCustomerInfo(lapsed, 'trial')).toBe('expired');
  });
});

describe('end to end: the flip does not evict a player mid-trial', () => {
  it('keeps a 6-day-in trial alive through a store read AND the lifecycle', () => {
    const DAY = 24 * 60 * 60 * 1000;
    const now = Date.UTC(2026, 7, 30);
    const trialStartedAt = now - 6 * DAY;

    // 1. The launch store read, on the first boot after billing turns on.
    const afterStoreRead = statusFromCustomerInfo(NEVER_PURCHASED, 'trial');
    expect(afterStoreRead).toBe('trial');

    // 2. The lifecycle, with whatever the store read left behind.
    const plan = planTrialLifecycle({
      subscriptionsEnabled: true,
      isOwner: false,
      status: afterStoreRead,
      promoExpiresAt: null,
      firstOpenedAt: now - 30 * DAY,
      trialStartedAt,
      trialDurationMs: 14 * DAY,
      now,
    });
    // 8 days left: nothing to do, and crucially NOT a demotion.
    expect(plan).toEqual({});
    expect(plan.setStatus).toBeUndefined();
  });
});
