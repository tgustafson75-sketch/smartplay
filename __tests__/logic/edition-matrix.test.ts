// ── EDITION MATRIX GUARD ─────────────────────────────────────────────────────
//
// 2026-08-19. Two jobs, and the first one matters more than the second.
//
// 1. TESTERS MUST SEE NOTHING. Tim: "don't put the paywall in for testers yet or
//    start a 30 day clock." The Lite/Full mechanism was built in the same pass
//    that instruction was given, so the risk of it leaking into the tester build
//    is real and immediate. Every assertion in the first block exists to make
//    that leak loud instead of silent — a paywall appearing for a tester, or a
//    trial clock quietly starting, would be discovered in the field otherwise.
//
// 2. The split itself is coherent — no feature without an edition, and the
//    front door is never behind the wall.
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

const ALL_FEATURES = Object.keys(FEATURE_EDITION) as FeatureKey[];
const ALL_STATUSES: SubscriptionStatus[] = ['trial', 'expired', 'active', 'free', 'lifetime'];

describe('subscriptions are OFF — testers see no paywall and no clock', () => {
  it('the kill-switch is off', () => {
    expect(SUBSCRIPTIONS_ENABLED).toBe(false);
  });

  it('every feature is unlocked in every billing state', () => {
    const locked: string[] = [];
    for (const f of ALL_FEATURES) {
      for (const s of ALL_STATUSES) {
        if (!canAccess(f, s)) locked.push(`${f}@${s}`);
      }
    }
    expect(locked).toEqual([]);
  });

  it('no trial clock runs — even with a trial start timestamp on the profile', () => {
    // The dangerous case is not a null timestamp; it is a profile that ALREADY
    // carries one (set by the boot trial-lifecycle) and a countdown quietly
    // starting off the back of it.
    expect(trialDaysLeft(null)).toBeNull();
    expect(trialDaysLeft(Date.now())).toBeNull();
    expect(trialDaysLeft(Date.now() - 30 * 24 * 60 * 60 * 1000)).toBeNull();
  });

  it('every billing state resolves to the full edition while the switch is off', () => {
    for (const s of ALL_STATUSES) expect(editionFor(s)).toBe('full');
  });
});

describe('the Lite/Full split is coherent (mechanism, dormant today)', () => {
  it('every feature is assigned an edition', () => {
    const unassigned = ALL_FEATURES.filter(f => !['lite', 'full'].includes(FEATURE_EDITION[f]));
    expect(unassigned).toEqual([]);
  });

  it('starting a round is Lite — the front door is never behind the wall', () => {
    // A new player must be able to experience the product before paying. This
    // was the old scaffolding's actual behaviour (round_start was paywalled) and
    // it is both a bad funnel and a hard App Store review conversation.
    expect(FEATURE_EDITION.round_start).toBe('lite');
  });

  it('every inference-spending feature is Full — the wall sits on marginal cost', () => {
    for (const f of ['smartvision', 'smartfinder', 'cage_mode', 'voice_advanced', 'send_to_tank'] as FeatureKey[]) {
      expect(FEATURE_EDITION[f]).toBe('full');
    }
  });

  it('Lite is a strict subset of Full', () => {
    const lite = featuresIn('lite');
    const full = featuresIn('full');
    expect(lite.every(f => full.includes(f))).toBe(true);
    expect(full.length).toBeGreaterThan(lite.length);
  });
});
