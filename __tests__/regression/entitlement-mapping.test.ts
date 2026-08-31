/**
 * 2026-08-29 — what the store says a player owns, and what the app does about it.
 *
 * The App Store is the subscription handler; `statusFromCustomerInfo` is the seam where its answer
 * becomes ours. It runs on every launch, on every purchase and on every restore, and it is the one
 * piece of the billing path that can be tested honestly — the rest is a native module the jest
 * suite cannot load, which is exactly why the decisions were pulled out into a pure function.
 *
 * Two of these would be real, user-visible failures rather than test-shaped ones:
 *
 *   - `'lifetime'` is an OWNER GRANT from the allow-list in playerProfileStore. The store has never
 *     heard of it, so a store read reports no entitlement — and a naive mapping writes 'free' over
 *     it on the first launch after billing goes live, locking Tim out of his own app.
 *   - A launch with no signal must change nothing. Guessing 'free' when the store cannot be reached
 *     revokes the caddie from someone who paid, on the first tee, with no way back.
 */

import {
  statusFromCustomerInfo,
  trialStartFromCustomerInfo,
  ENTITLEMENT_ID,
} from '../../services/billing/purchases';
import { PRICING } from '../../lib/pricing';

const info = (
  active: Record<string, unknown> | null,
  all: Record<string, unknown> | null = null,
) => ({
  entitlements: {
    active: active ? { [ENTITLEMENT_ID]: active } : {},
    all: all ? { [ENTITLEMENT_ID]: all } : active ? { [ENTITLEMENT_ID]: active } : {},
  },
});

describe('an owner grant survives whatever the store says', () => {
  it.each([
    ['nothing at all', info(null)],
    ['an expired entitlement', info(null, { isActive: false })],
    ['a null response', null],
    ['an undefined response', undefined],
    ['a malformed response', { entitlements: undefined } as never],
  ])('keeps lifetime when the store reports %s', (_label, customerInfo) => {
    // The failure this prevents: Tim opens the app after billing goes live and is locked out of it.
    expect(statusFromCustomerInfo(customerInfo as never, 'lifetime')).toBe('lifetime');
  });
});

describe('an unreachable store changes nothing', () => {
  it.each(['free', 'trial', 'active', 'expired'] as const)(
    'leaves %s alone when there is no entitlement data',
    (current) => {
      expect(statusFromCustomerInfo(null, current)).toBe(current);
      expect(statusFromCustomerInfo(undefined, current)).toBe(current);
      expect(statusFromCustomerInfo({} as never, current)).toBe(current);
    },
  );
});

describe('an active entitlement', () => {
  it('is a trial while the store says the period is a trial', () => {
    expect(statusFromCustomerInfo(info({ isActive: true, periodType: 'TRIAL' }), 'free')).toBe('trial');
  });

  it('reads the period type case-insensitively', () => {
    // periodType is typed `string` on the RN surface and an enum internally. If a casing change
    // slipped past, every trial would silently bill as a paid subscription in our own UI.
    for (const p of ['trial', 'Trial', 'TRIAL']) {
      expect(statusFromCustomerInfo(info({ isActive: true, periodType: p }), 'free')).toBe('trial');
    }
  });

  it('is active for a normal or introductory period', () => {
    for (const p of ['NORMAL', 'INTRO', '', undefined]) {
      expect(statusFromCustomerInfo(info({ isActive: true, periodType: p }), 'free')).toBe('active');
    }
  });

  it('upgrades someone who was expired', () => {
    expect(statusFromCustomerInfo(info({ isActive: true, periodType: 'NORMAL' }), 'expired')).toBe('active');
  });
});

describe('no active entitlement', () => {
  it('is EXPIRED for someone who once had it, not free', () => {
    // featureAccess treats both as Lite, but they are different people and the paywall should not
    // greet a lapsed subscriber as a brand-new one.
    const lapsed = { entitlements: { active: {}, all: { [ENTITLEMENT_ID]: { isActive: false } } } };
    expect(statusFromCustomerInfo(lapsed, 'active')).toBe('expired');
  });

  it('does not INVENT a status for someone who never had it', () => {
    const never = { entitlements: { active: {}, all: {} } };
    expect(statusFromCustomerInfo(never, 'free')).toBe('free');
  });

  it('does not TAKE AWAY a status the store never issued', () => {
    /**
     * 2026-08-30 — this line asserted `statusFromCustomerInfo(never, 'trial')` is 'free', and that
     * assertion was written on 08-29, one day before Tim decided the free cohort CONVERTS TO TRIAL
     * when billing turns on. It encoded a demotion.
     *
     * RevenueCat returns `{ active: {}, all: {} }` for a non-purchaser — present, so the null guard
     * misses it, and empty, so nothing matched. A player six days into OUR 14-day trial was written
     * to 'free' on the first launch after the flip, then matched no rung in planTrialLifecycle
     * (its trial rung requires `!trialStartedAt`), and lost the caddie mid-trial. Comps went the
     * same way: grantPromo writes 'active' with no purchase behind it.
     *
     * The store is authoritative about what the STORE issued. Silence is not a downgrade.
     */
    const never = { entitlements: { active: {}, all: {} } };
    expect(statusFromCustomerInfo(never, 'trial')).toBe('trial');
    expect(statusFromCustomerInfo(never, 'active')).toBe('active');
    // A real lapse still downgrades, because there the store DOES have an opinion.
    const lapsed = { entitlements: { active: {}, all: { [ENTITLEMENT_ID]: { isActive: false } } } };
    expect(statusFromCustomerInfo(lapsed, 'trial')).toBe('expired');
  });

  it('ignores an entitlement that is not ours', () => {
    const other = { entitlements: { active: { something_else: { isActive: true } }, all: {} } };
    expect(statusFromCustomerInfo(other, 'free')).toBe('free');
  });
});

describe('the trial clock belongs to the store, and starts at the purchase', () => {
  const DAY = 24 * 60 * 60 * 1000;

  it('derives when the trial began from the expiry the store reports', () => {
    const expires = Date.now() + 3 * DAY;
    const started = trialStartFromCustomerInfo(
      info({ isActive: true, periodType: 'TRIAL', expirationDateMillis: expires }),
    );
    expect(started).toBe(expires - PRICING.trialDays * DAY);
  });

  it('feeds the ONE countdown a start that makes it right', () => {
    // The bug this closes: initTrial() stamps trial_started_at at FIRST APP OPEN, and app/(tabs)/
    // caddie.tsx counts down from it. Under IAP the trial begins at PURCHASE. Someone who installs,
    // plays for a fortnight, then subscribes would be told their new trial had already expired.
    expect(PRICING.trialDays).toBe(14);
    const expires = Date.now() + 14 * DAY;
    const started = trialStartFromCustomerInfo(
      info({ isActive: true, periodType: 'TRIAL', expirationDateMillis: expires }),
    )!;
    const daysLeft = PRICING.trialDays - Math.floor((Date.now() - started) / DAY);
    expect(daysLeft).toBe(14);
  });

  it('is null for anyone the store does not report as being in a trial', () => {
    expect(trialStartFromCustomerInfo(info({ isActive: true, periodType: 'NORMAL' }))).toBeNull();
    expect(trialStartFromCustomerInfo(info(null))).toBeNull();
    expect(trialStartFromCustomerInfo(null)).toBeNull();
  });

  it('is null rather than a guess when the store gives no expiry', () => {
    // Returning a fabricated start would silently reset someone's trial to full length.
    expect(
      trialStartFromCustomerInfo(info({ isActive: true, periodType: 'TRIAL', expirationDateMillis: null })),
    ).toBeNull();
  });
});

describe('the identifiers the dashboard must match', () => {
  it('pins the entitlement id and the product ids', () => {
    // These are typed into App Store Connect, Play Console and RevenueCat by hand. If the string
    // here and the string there disagree, every paying customer reads as unsubscribed and nothing
    // in the app can tell you why. Changing one of these means changing a dashboard too.
    // Corrected 2026-08-30: the RevenueCat project uses 'smartplay_caddie_pro', not the 'full' I
    // had picked to match the app's Lite/Full language. The dashboard's identifier is the only one
    // the SDK answers to.
    expect(ENTITLEMENT_ID).toBe('smartplay_caddie_pro');
    expect(PRICING.monthly.productId).toBe('com.smartplaycaddie.app.full.monthly');
    expect(PRICING.annual.productId).toBe('com.smartplaycaddie.app.full.annual');
  });
});
