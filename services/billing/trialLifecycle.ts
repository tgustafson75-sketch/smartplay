/**
 * 2026-08-30 — WHAT A PLAYER'S BILLING STATE SHOULD BE, as a function instead of a paragraph.
 *
 * This ladder lived inside a boot effect in app/_layout.tsx, where it could not be tested: it reads
 * a zustand store, writes through four different setters, and runs behind a hydration guard. So the
 * only way to know what it did on any given profile was to read it and believe yourself — and on
 * 2026-08-30 that failed. The kill-switch branch stamped a PERSISTED 'lifetime' on every launch-
 * period user, which the flip to paid then skipped over, and nothing in 1,855 tests could see it.
 *
 * The decision is pure and the effect only carries it out. That is the whole point:
 * [[arithmetic-belongs-in-code-not-the-model]] — a rule you can run beats a rule you can read.
 *
 * ORDER IS THE SPECIFICATION. Each rung exists because of a real defect:
 *   1. PROMO first, because both blanket grants below re-assert on every boot and would overwrite a
 *      comp on next launch — a 30-day promotion would have lasted until the app was closed.
 *   2. OWNER before the kill-switch, so the switch's branch can assume it is not an owner and clear
 *      a stale lifetime without locking Tim out of his own app.
 *   3. KILL-SWITCH stamps NOTHING. canAccess() already returns true for everything while it is off,
 *      so a grant buys nobody anything and only writes state that survives the flip.
 *   4. A lifetime on a non-owner is a kill-switch leftover and is cleared to 'free'.
 *   5. A LEGACY app trial already running heals and expires on its own dates.
 *
 * 2026-09-28 (1.0.2) — THE APP NO LONGER GRANTS A TRIAL. The store's introductory offer (one month,
 * started from the plans screen) is the only trial. A fresh install, the launch cohort and a cleared
 * lifetime all land on 'free'. Rung 5 is kept so the 14-day app trials already running when 1.0.2
 * installs finish on the dates their players were promised.
 */

import type { SubscriptionStatus } from '../../store/playerProfileStore';

export type LifecycleInput = {
  subscriptionsEnabled: boolean;
  isOwner: boolean;
  status: SubscriptionStatus;
  promoExpiresAt: number | null;
  firstOpenedAt: number | null;
  trialStartedAt: number | null;
  trialDurationMs: number;
  now: number;
  /**
   * 2026-09-28 (1.0.2) — the store's last answer on a live paid entitlement (profile
   * store_entitlement_active). Only consulted when a promo ends. Only an explicit `false` lets a
   * promo's 'active' lapse: null/absent means the store has not answered yet on this install, and a
   * subscriber must never be downgraded on a guess. Every launch's store read records the answer, so
   * a promo-only player lapses by the next launch at the latest.
   */
  storeEntitled?: boolean | null;
};

/**
 * What the caller must do. Every field is optional and defaults to "leave it alone" — a plan of all
 * false is a legitimate, common answer, and is not the same as an error.
 */
export type LifecyclePlan = {
  clearPromo?: boolean;
  grantLifetime?: boolean;
  setStatus?: SubscriptionStatus;
};

export function planTrialLifecycle(input: LifecycleInput): LifecyclePlan {
  const {
    subscriptionsEnabled, isOwner, status, promoExpiresAt,
    trialStartedAt, trialDurationMs, now,
  } = input;

  // 1) An active comp outranks both blanket grants below.
  if (promoExpiresAt != null) {
    if (promoExpiresAt > now) {
      return status === 'active' ? {} : { setStatus: 'active' };
    }
    // Expired: clear it and fall through to the normal ladder, so running out is visible in the
    // status without locking anyone out of anything.
    const rest = planTrialLifecycle({ ...input, promoExpiresAt: null });
    /**
     * 2026-09-28 (1.0.2) — AND THE ACCESS IT GRANTED ENDS WITH IT. grantPromo / extendPromo (referral
     * rewards, owner comps, the old trial extension) all write 'active'; the fall-through above has no
     * rung for 'active', so the comp cleared and the player stayed Pro for ever. An 'active' the store
     * does not vouch for came from the promo and lapses to 'expired'. A store subscriber — a referral
     * reward stacked on a paid plan is exactly this — is never touched here; the store owns their status.
     */
    if (status === 'active' && input.storeEntitled === false && !isOwner && subscriptionsEnabled && !rest.setStatus && !rest.grantLifetime) {
      return { clearPromo: true, ...rest, setStatus: 'expired' };
    }
    return { clearPromo: true, ...rest };
  }

  // 2) Owner lifetime wins over everything, and is decided before the kill-switch.
  if (isOwner) return status === 'lifetime' ? {} : { grantLifetime: true };

  // 3) Kill-switch: unlocked, unstamped, and any old blanket grant cleared.
  if (!subscriptionsEnabled) {
    return status === 'lifetime' ? { setStatus: 'free' } : {};
  }

  /**
   * 4) A lifetime that survived to here CANNOT be real, so it is cleared rather than honoured.
   *
   * 2026-09-01 (adversarial audit) — this rung used to return {} on the reasoning that owner accounts
   * already returned at rung 2, so anything left must be a genuine grant. But there is no lifetime
   * PRODUCT: purchases.ts states it plainly — 'lifetime' is an owner grant from the allow-list, not
   * something the store sells. So a non-owner cannot legitimately hold one, and every one that
   * reaches here is a leftover from the kill-switch period that stamped it on everybody.
   *
   * Rung 3 already clears exactly this while billing is OFF. The gap was a player who does not open
   * the app between that remediation and the flip: their stale grant survives, rung 4 honours it, and
   * they have the app free forever with no way back. Same population, same staleness, opposite
   * answer — the two rungs now agree, and the cleared player falls through to the trial below.
   *
   * A mis-detected owner is no new risk: rung 3 has stripped that same player every launch since
   * 08-30, so this changes when the correction happens, not whether.
   *
   * 2026-09-28 (1.0.2) — cleared to 'free'. It used to convert to an app trial; the app no longer
   * grants one, so the store's introductory offer on the plans screen is their trial too.
   */
  if (status === 'lifetime') return { setStatus: 'free' };

  // 5) A legacy app trial already running — no new ones start here (see the header).
  /**
   * 2026-09-18 — HEAL A TRIAL THAT WAS GRANTED AND THEN CLOBBERED.
   *
   * Read off Tim's own App Store install: `first_opened_at` and `trial_started_at` identical to the
   * millisecond (only initTrial writes those together, and it writes 'trial' with them) and a status
   * of 'free'. The boot entitlement refresh echoed a stale 'free' over the grant — fixed at source
   * in planEntitlementWrite — but the fix alone does not rescue anybody it has already happened to,
   * and that is EVERY install since 1.0 went live.
   *
   * Nothing above catches them: the rung directly overhead requires `!trialStartedAt` and theirs is
   * set, so they fall through to `{}` and stay on the lite edition for ever, with a caddie that
   * answers "That one got away from me" to every single thing they say.
   *
   * Narrow by construction — 'free' WITH a start stamp INSIDE the window is only reachable by that
   * clobber. A cancellation or refund lands on 'expired' (the store keeps the entitlement in `all`),
   * a real never-started player has no stamp, and a stamp older than the window is left alone rather
   * than resurrected. [[two-owners-is-the-root-cause]] [[a-guard-can-enforce-a-stale-premise]]
   */
  if (status === 'free' && trialStartedAt && now - trialStartedAt <= trialDurationMs) {
    return { setStatus: 'trial' };
  }
  if (status === 'trial' && trialStartedAt && now - trialStartedAt > trialDurationMs) {
    return { setStatus: 'expired' };
  }
  return {};
}
