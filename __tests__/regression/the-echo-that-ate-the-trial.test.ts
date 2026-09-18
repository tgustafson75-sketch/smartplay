/**
 * 2026-09-18 — EVERY NEW CUSTOMER LOST THE 14-DAY TRIAL ON THEIR FIRST LAUNCH, AND THE CADDIE WENT
 * MUTE. Read off Tim's own App Store install of 1.0, not inferred:
 *
 *     first_opened_at     = 1789763755619   ┐ identical to the millisecond, and ONLY initTrial
 *     trial_started_at    = 1789763755619   ┘ ever writes those two together
 *     subscription_status = 'free'            …while initTrial writes 'trial' in the SAME set()
 *
 * So the trial was granted and then destroyed. `mayTalkToCaddie()` gates on `voice_advanced`, which
 * 'free' does not grant, so `conversationalBrainTurn` returned NO_ANSWER without ever calling the
 * brain, and the delivery contract did the only honest thing left: "That one got away from me — say
 * it again?" Three times in his issue log, with `warmed: true` — the warmup was fine, the network
 * was fine, the API was healthy. Nothing was ever asked.
 *
 * THE RACE. Two boot effects fire at hydration:
 *
 *   entitlement refresh          trial lifecycle
 *   ──────────────────           ───────────────
 *   before = 'free'  (default on a first launch, nothing persisted yet)
 *   await store  ────────────►   initTrial() → status = 'trial'
 *   store never heard of them → statusFromCustomerInfo ECHOES 'free'
 *   write 'free'  ◄── over the trial that was granted while it was in flight
 *
 * The call site protected `'lifetime'` and only 'lifetime'. Its own comment says it exists to stop
 * a stale 'free' landing on a grant — it guarded the owner arm and let every paying customer's
 * trial through the other one.
 *
 * Two halves, both needed: stop the echo (planEntitlementWrite) and rescue the people it already
 * happened to, which is every install since 1.0 went live (planTrialLifecycle's heal rung). A fix
 * without the heal leaves them stranded for ever, because the rung above the heal requires
 * `!trialStartedAt` and theirs is set.
 */
import { planEntitlementWrite, statusFromCustomerInfo } from '../../services/billing/purchases';
import { planTrialLifecycle } from '../../services/billing/trialLifecycle';
import { canAccess, SUBSCRIPTIONS_ENABLED } from '../../services/featureAccess';

/** Exactly what RevenueCat returns for a player who has never purchased. */
const NEVER_PURCHASED = { entitlements: { active: {}, all: {} } };
const DAY = 24 * 60 * 60 * 1000;
const TRIAL_MS = 14 * DAY;

describe('the echo must not land on the grant', () => {
  it('REPRODUCES the fresh install: the mapping echoes free while the app granted trial', () => {
    // Step by step, with the real functions — this is the sequence, not a re-statement of it.
    const before = 'free' as const;                                  // zustand default, first launch
    const mapped = statusFromCustomerInfo(NEVER_PURCHASED, before);  // the store has no opinion
    expect(mapped).toBe('free');                                     // …so it echoes
    const now = 'trial' as const;                                    // initTrial ran during the await
    // THE REGRESSION: the old call site wrote `mapped` here because it only checked for 'lifetime'.
    expect(planEntitlementWrite({ before, mapped, now })).toBeNull();
  });

  it('still protects an owner grant made during the same flight', () => {
    expect(planEntitlementWrite({ before: 'free', mapped: 'free', now: 'lifetime' })).toBeNull();
  });

  it('still protects a comp granted during the same flight', () => {
    // grantPromo writes 'active' locally with no purchase behind it.
    expect(planEntitlementWrite({ before: 'free', mapped: 'free', now: 'active' })).toBeNull();
  });

  it('still lets the store DOWNGRADE someone it has an opinion about', () => {
    // A refund or lapse: RevenueCat keeps the entitlement in `all`, so the mapping says 'expired'
    // and that is real knowledge, not an echo. It must still be written.
    expect(planEntitlementWrite({ before: 'active', mapped: 'expired', now: 'active' })).toBe('expired');
  });

  it('still lets the store UPGRADE a player who just bought', () => {
    expect(planEntitlementWrite({ before: 'free', mapped: 'active', now: 'free' })).toBe('active');
    expect(planEntitlementWrite({ before: 'free', mapped: 'trial', now: 'free' })).toBe('trial');
  });

  it('writes nothing when nothing changed', () => {
    expect(planEntitlementWrite({ before: 'trial', mapped: 'trial', now: 'trial' })).toBeNull();
  });
});

describe('the players it already happened to are healed', () => {
  const now = 1789763755619 + 3 * DAY;
  /** Tim's profile, exactly as it sits on disk after installing 1.0 from the App Store. */
  const clobbered = {
    subscriptionsEnabled: true,
    isOwner: false,
    status: 'free' as const,
    promoExpiresAt: null,
    firstOpenedAt: 1789763755619,
    trialStartedAt: 1789763755619,
    trialDurationMs: TRIAL_MS,
    now,
  };

  it('a stranded trial is restored, not left on lite for ever', () => {
    // THE REGRESSION: this returned {} — no rung matched, so they stayed 'free' permanently.
    expect(planTrialLifecycle(clobbered)).toEqual({ setStatus: 'trial' });
  });

  it('and that restores the thing he actually lost — talking to the caddie', () => {
    // The whole point. 'free' cannot reach voice_advanced; 'trial' can.
    expect(SUBSCRIPTIONS_ENABLED).toBe(true);        // the heal is only load-bearing while this is on
    expect(canAccess('voice_advanced', 'free')).toBe(false);
    expect(canAccess('voice_advanced', 'trial')).toBe(true);
  });

  it('does NOT resurrect a trial that genuinely ran out', () => {
    const lapsed = { ...clobbered, now: clobbered.trialStartedAt + TRIAL_MS + DAY };
    expect(planTrialLifecycle(lapsed)).toEqual({});
  });

  it('does NOT touch someone the store says is expired', () => {
    expect(planTrialLifecycle({ ...clobbered, status: 'expired' })).toEqual({});
  });

  it('a genuinely new player still gets a fresh trial, not a heal', () => {
    expect(planTrialLifecycle({ ...clobbered, firstOpenedAt: null, trialStartedAt: null }))
      .toEqual({ initTrial: true });
  });
});
