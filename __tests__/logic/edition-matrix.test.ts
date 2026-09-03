// ── EDITION MATRIX GUARD ─────────────────────────────────────────────────────
//
// 2026-08-19, REWRITTEN 2026-09-03 WHEN THE SWITCH FLIPPED FOR THE LAUNCH BUILD.
//
// The original job was "testers must see nothing": SUBSCRIPTIONS_ENABLED was false, and every
// assertion here existed to make a paywall or a trial clock leaking into the tester build loud
// instead of silent. That job is finished — the switch is on, the store listing and the Play
// Purchase-history declaration both describe a paid app, and the binary now matches the paperwork.
//
// Deleting this file with the switch would have been the wrong move. Flipping the switch does not
// remove the risk it was guarding, it INVERTS it. The old danger was a wall appearing where none
// was meant to be; the new danger is a wall appearing somewhere it must never be. So the same
// three properties are asserted against the live behaviour instead of against the kill-switch:
//
// 1. THE FRONT DOOR IS NEVER WALLED. round_start must work in every billing state, including
//    'expired' and 'free'. A new player has to be able to play a round before paying, and an
//    expired subscriber has to be able to finish the round they are standing in the middle of.
// 2. AN EXPIRED PLAYER KEEPS THEIR OWN DATA. 'expired' lands on 'lite', not on nothing — they lose
//    the caddie, not their scorecard, their history or their bag.
// 3. THE SPLIT ITSELF IS COHERENT — no feature without an edition, and the wall sits only on the
//    features that spend inference per use.
//
// The trial clock is now asserted RUNNING rather than asserted silent, because a clock that does
// not start is how a paying cohort gets locked out on the day the update lands.
import {
  canAccess,
  editionFor,
  featuresIn,
  trialDaysLeft,
  FEATURE_EDITION,
  SUBSCRIPTIONS_ENABLED,
  type FeatureKey,
} from '../../services/featureAccess';
import type { SubscriptionStatus } from '../../store/playerProfileStore';
import { PRICING } from '../../lib/pricing';

const ALL_FEATURES = Object.keys(FEATURE_EDITION) as FeatureKey[];
const ALL_STATUSES: SubscriptionStatus[] = ['trial', 'expired', 'active', 'free', 'lifetime'];
const DAY = 24 * 60 * 60 * 1000;

describe('subscriptions are ON — the wall exists, and it is in the right place', () => {
  it('the kill-switch is on', () => {
    // If this ever reads false again in a shipped build, the listing promises a paid product the
    // binary gives away, and the Purchase-history declaration is false.
    expect(SUBSCRIPTIONS_ENABLED).toBe(true);
  });

  it('starting a round works in EVERY billing state — including expired and free', () => {
    // The single most damaging thing this flip could have done. A player mid-round when their
    // trial lapses must not be stopped, and a brand-new install must be able to play.
    const walled = ALL_STATUSES.filter(s => !canAccess('round_start', s));
    expect(walled).toEqual([]);
  });

  it('the Pro features are locked for free and expired, and open for trial, active and lifetime', () => {
    const PRO_ONLY: FeatureKey[] = ['smartvision', 'smartfinder', 'cage_mode', 'voice_advanced'];
    for (const f of PRO_ONLY) {
      for (const s of ['trial', 'active', 'lifetime'] as SubscriptionStatus[]) {
        expect([f, s, canAccess(f, s)]).toEqual([f, s, true]);
      }
      for (const s of ['free', 'expired'] as SubscriptionStatus[]) {
        expect([f, s, canAccess(f, s)]).toEqual([f, s, false]);
      }
    }
  });

  it('an expired player lands on lite, not on nothing — they keep their own data', () => {
    expect(editionFor('expired')).toBe('lite');
    expect(editionFor('free')).toBe('lite');
    for (const s of ['trial', 'active', 'lifetime'] as SubscriptionStatus[]) {
      expect(editionFor(s)).toBe('pro');
    }
  });

  it('the trial clock now RUNS, and runs for the number the paywall promised', () => {
    // It was hardcoded to 7 here while the paywall promised 14 in three places. That bug was
    // invisible while the switch was off and would have landed on people who had just paid.
    expect(trialDaysLeft(null)).toBeNull();
    expect(trialDaysLeft(Date.now())).toBe(PRICING.trialDays);
    expect(trialDaysLeft(Date.now() - 13 * DAY)).toBe(PRICING.trialDays - 13);
    // Floors at zero rather than going negative — an expired clock reads 0 days, never "-16 days".
    expect(trialDaysLeft(Date.now() - 30 * DAY)).toBe(0);
  });
});

describe('the Lite/Full split is coherent', () => {
  it('every feature is assigned an edition', () => {
    const unassigned = ALL_FEATURES.filter(f => !['lite', 'pro'].includes(FEATURE_EDITION[f]));
    expect(unassigned).toEqual([]);
  });

  it('starting a round is Lite — the front door is never behind the wall', () => {
    // A new player must be able to experience the product before paying. This
    // was the old scaffolding's actual behaviour (round_start was paywalled) and
    // it is both a bad funnel and a hard App Store review conversation.
    expect(FEATURE_EDITION.round_start).toBe('lite');
  });

  it('every inference-spending feature is Full — the wall sits on marginal cost', () => {
    for (const f of ['smartvision', 'smartfinder', 'cage_mode', 'voice_advanced'] as FeatureKey[]) {
      expect(FEATURE_EDITION[f]).toBe('pro');
    }
  });

  it('Lite is a strict subset of Full', () => {
    const lite = featuresIn('lite');
    const full = featuresIn('pro');
    expect(lite.every(f => full.includes(f))).toBe(true);
    expect(full.length).toBeGreaterThan(lite.length);
  });
});
