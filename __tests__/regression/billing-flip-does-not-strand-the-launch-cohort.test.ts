/**
 * 2026-08-30 — TURNING BILLING ON MUST ACTUALLY TURN BILLING ON.
 *
 * The defect this pins was invisible to 1,855 passing tests, because the ladder that carried it
 * lived inside a boot effect and nothing could call it.
 *
 * While SUBSCRIPTIONS_ENABLED is false the kill-switch rung called grantLifetime() on EVERY player.
 * That grant bought nobody anything — canAccess() already returns true for everything while the
 * switch is off — but it wrote 'lifetime' into PERSISTED storage, the next rung returns early for
 * anyone already lifetime, and statusFromCustomerInfo preserves it a second time. Nothing clears it.
 *
 * So the OTA that flips the switch to true, sent to phones already in the field, would have started
 * no trial and shown no paywall to a single person who had ever opened the app. Silently, and with
 * no way back.
 *
 * The mirror-image failure is just as bad and one line away: if the flip merely stops granting, the
 * launch cohort matches no rung at all, sits at 'free', resolves to the 'lite' edition, and is
 * locked out of the caddie the moment the update lands.
 *
 * Tim's call (2026-08-30): the free cohort CONVERTS TO TRIAL. Both failures are pinned below.
 *
 * 2026-09-28 (1.0.2) — SUPERSEDED BY TIM'S NEXT CALL: the store's introductory offer (one month, from
 * the plans screen) is the ONLY trial. The app grants none — not to a fresh install, not to the launch
 * cohort, not to a cleared lifetime. They land on 'free' and the paywall is how they start a trial.
 * The first failure above (a persisted lifetime nobody clears) is still pinned; the second is now the
 * intended state, reached on purpose. A legacy app trial already running still counts down and expires.
 */

import { planTrialLifecycle, type LifecycleInput } from '../../services/billing/trialLifecycle';
import { editionFor } from '../../services/featureAccess';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 7, 30);

const base: LifecycleInput = {
  subscriptionsEnabled: false,
  isOwner: false,
  status: 'free',
  promoExpiresAt: null,
  firstOpenedAt: null,
  trialStartedAt: null,
  trialDurationMs: 14 * DAY,
  now: NOW,
};

describe('while billing is off, nothing is stamped', () => {
  it('does not grant lifetime to an ordinary player', () => {
    // THE REGRESSION. Before the fix this returned { grantLifetime: true } for every user alive.
    expect(planTrialLifecycle({ ...base, firstOpenedAt: NOW - 30 * DAY })).toEqual({});
  });

  it('clears a lifetime an earlier build already wrote to disk', () => {
    // Build 12 and 18 testers carry the old stamp. Declining to write it is not enough.
    expect(planTrialLifecycle({ ...base, status: 'lifetime', firstOpenedAt: NOW - 30 * DAY }))
      .toEqual({ setStatus: 'free' });
  });

  it('leaves the owner alone — clearing his lifetime would lock Tim out of his own app', () => {
    expect(planTrialLifecycle({ ...base, isOwner: true, status: 'lifetime' })).toEqual({});
    expect(planTrialLifecycle({ ...base, isOwner: true, status: 'free' }))
      .toEqual({ grantLifetime: true });
  });
});

describe('the flip: a player who installed during the free period', () => {
  /** Exactly what is on disk for someone who installed in the 1.0 window and never paid. */
  const launchCohort = { ...base, firstOpenedAt: NOW - 30 * DAY, trialStartedAt: null, status: 'free' as const };

  it('1.0.2: stays on free — the store offer on the plans screen is their trial', () => {
    const plan = planTrialLifecycle({ ...launchCohort, subscriptionsEnabled: true });
    expect(plan).toEqual({});
  });

  it('a LEGACY app trial already running keeps counting down', () => {
    const started = NOW;
    const plan = planTrialLifecycle({
      ...launchCohort, subscriptionsEnabled: true, status: 'trial', trialStartedAt: started,
      now: started + 13 * DAY,
    });
    expect(plan).toEqual({});
  });

  it('still expires on day 15 like anyone else', () => {
    const started = NOW;
    expect(planTrialLifecycle({
      ...launchCohort, subscriptionsEnabled: true, status: 'trial', trialStartedAt: started,
      now: started + 15 * DAY,
    })).toEqual({ setStatus: 'expired' });
  });

  it('the editions the statuses resolve to', () => {
    // 2026-09-03. This used to read: for every status, editionFor() === 'pro'. That was true only
    // because SUBSCRIPTIONS_ENABLED was false and editionFor short-circuited — the comment here
    // said the post-flip mapping could not be asserted for exactly that reason.
    //
    // The switch is now on, so it can be, and it is the half that closes the loop. The tests above
    // prove the stored PLAN converts this cohort to a trial. This proves that plan is worth
    // something: that 'trial' resolves to Pro, and that the two states the cohort could have been
    // stranded in resolve to lite — they keep their rounds, their stats and their bag either way.
    expect(editionFor('trial')).toBe('pro');
    expect(editionFor('active')).toBe('pro');
    expect(editionFor('lifetime')).toBe('pro');
    expect(editionFor('free')).toBe('lite');
    expect(editionFor('expired')).toBe('lite');
  });
});

describe('1.0.2: a fresh install lands on free and never on trial', () => {
  it('the first launch writes nothing — the profile default is free', () => {
    expect(planTrialLifecycle({ ...base, subscriptionsEnabled: true })).toEqual({});
  });

  it('never becomes trial over a month of launches, however they are spaced', () => {
    // Replays the boot effect: each launch applies the plan to the status the last one left.
    let status: LifecycleInput['status'] = 'free';
    let firstOpenedAt: number | null = null;
    for (let day = 0; day <= 31; day++) {
      const now = NOW + day * DAY;
      const plan = planTrialLifecycle({ ...base, subscriptionsEnabled: true, status, firstOpenedAt, now });
      expect(plan).not.toHaveProperty('initTrial');
      if (plan.setStatus) status = plan.setStatus;
      firstOpenedAt = firstOpenedAt ?? now; // the boot effect stamps first open on its own now
      expect(status).toBe('free');
    }
    expect(editionFor(status)).toBe('lite');
  });

  it('is left completely alone when billing is off', () => {
    expect(planTrialLifecycle(base)).toEqual({});
  });
});

describe('an active comp still outranks both blanket grants', () => {
  it('holds active, and is checked before the owner and kill-switch rungs', () => {
    expect(planTrialLifecycle({ ...base, promoExpiresAt: NOW + 5 * DAY, status: 'free' }))
      .toEqual({ setStatus: 'active' });
    // Even for an owner: a comp set deliberately on Tim's account is the thing being tested.
    expect(planTrialLifecycle({ ...base, isOwner: true, promoExpiresAt: NOW + 5 * DAY, status: 'active' }))
      .toEqual({});
  });

  it('clears when expired and falls through rather than stranding the player on active', () => {
    const plan = planTrialLifecycle({
      ...base, subscriptionsEnabled: true, promoExpiresAt: NOW - DAY,
      status: 'active', firstOpenedAt: NOW - 30 * DAY,
    });
    expect(plan.clearPromo).toBe(true);
    // 2026-09-28 (1.0.2) — the store has not answered on this install (storeEntitled absent), so this
    // could be a subscriber: clear the comp, leave the status. The lapse itself is pinned in
    // __tests__/regression/a-promo-lapses-a-subscription-does-not.test.ts.
    expect(plan).toEqual({ clearPromo: true });
  });
});

describe('a stale lifetime cannot survive the flip (2026-09-01 audit)', () => {
  const base = {
    subscriptionsEnabled: true,
    isOwner: false,
    promoExpiresAt: null,
    firstOpenedAt: 1_000,
    trialStartedAt: null,
    trialDurationMs: 14 * 24 * 60 * 60 * 1000,
    now: 2_000_000,
  };

  it('THE GAP: a non-owner lifetime is cleared, not honoured', () => {
    // There is no lifetime PRODUCT — purchases.ts says so plainly: it is an owner grant from the
    // allow-list, and owners return at rung 2. So any lifetime reaching rung 4 is a leftover from the
    // kill-switch period that stamped it on everybody. Rung 3 clears exactly this while billing is
    // OFF; the gap was a player who never opens the app between that remediation and the flip.
    expect(planTrialLifecycle({ ...base, status: 'lifetime' })).toEqual({ setStatus: 'free' });
  });

  it('1.0.2: goes to free, not to an app trial — the store offer is the only trial', () => {
    const plan = planTrialLifecycle({ ...base, status: 'lifetime' });
    expect(plan).not.toHaveProperty('initTrial');
    expect(plan.setStatus).toBe('free');
  });

  it('an OWNER keeps lifetime — rung 2 still returns before this', () => {
    expect(planTrialLifecycle({ ...base, isOwner: true, status: 'lifetime' })).toEqual({});
  });

  it('and while billing is OFF the old rung still clears it', () => {
    expect(planTrialLifecycle({ ...base, subscriptionsEnabled: false, status: 'lifetime' }))
      .toEqual({ setStatus: 'free' });
  });
});
