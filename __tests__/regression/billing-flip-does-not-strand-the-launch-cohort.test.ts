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
 * Tim's call: the free cohort CONVERTS TO TRIAL. Both failures are pinned below.
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

  it('is NOT stranded on free with no trial', () => {
    const plan = planTrialLifecycle({ ...launchCohort, subscriptionsEnabled: true });
    expect(plan).toEqual({ initTrial: true });
  });

  it('gets a full 14 days from the flip, not an expired clock from install day', () => {
    // initTrial stamps trial_started_at = now. Anchoring to firstOpenedAt instead would hand a
    // 30-day-old install a trial that ran out a fortnight ago.
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

  it('after the flip, the trial it was converted to actually grants Pro', () => {
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

describe('a fresh install is unchanged', () => {
  it('starts a trial when billing is on', () => {
    expect(planTrialLifecycle({ ...base, subscriptionsEnabled: true })).toEqual({ initTrial: true });
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
    // Falls through to the trial rung rather than leaving a lapsed comp reading as paid.
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

  it('THE GAP: a non-owner lifetime is converted, not honoured', () => {
    // There is no lifetime PRODUCT — purchases.ts says so plainly: it is an owner grant from the
    // allow-list, and owners return at rung 2. So any lifetime reaching rung 4 is a leftover from the
    // kill-switch period that stamped it on everybody. Rung 3 clears exactly this while billing is
    // OFF; the gap was a player who never opens the app between that remediation and the flip.
    expect(planTrialLifecycle({ ...base, status: 'lifetime' })).toEqual({ initTrial: true });
  });

  it('converts to a TRIAL, never to free — free would strand them on lite for a session', () => {
    const plan = planTrialLifecycle({ ...base, status: 'lifetime' });
    expect(plan.setStatus).toBeUndefined();
    expect(plan.initTrial).toBe(true);
  });

  it('an OWNER keeps lifetime — rung 2 still returns before this', () => {
    expect(planTrialLifecycle({ ...base, isOwner: true, status: 'lifetime' })).toEqual({});
  });

  it('and while billing is OFF the old rung still clears it', () => {
    expect(planTrialLifecycle({ ...base, subscriptionsEnabled: false, status: 'lifetime' }))
      .toEqual({ setStatus: 'free' });
  });
});
