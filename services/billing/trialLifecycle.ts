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
 *   4. A real lifetime is left alone.
 *   5. The trial: start one for a fresh install, AND for the launch cohort on the day billing turns
 *      on — without that second case the flip locks out everyone who was here first.
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
};

/**
 * What the caller must do. Every field is optional and defaults to "leave it alone" — a plan of all
 * false is a legitimate, common answer, and is not the same as an error.
 */
export type LifecyclePlan = {
  clearPromo?: boolean;
  grantLifetime?: boolean;
  initTrial?: boolean;
  setStatus?: SubscriptionStatus;
};

export function planTrialLifecycle(input: LifecycleInput): LifecyclePlan {
  const {
    subscriptionsEnabled, isOwner, status, promoExpiresAt,
    firstOpenedAt, trialStartedAt, trialDurationMs, now,
  } = input;

  // 1) An active comp outranks both blanket grants below.
  if (promoExpiresAt != null) {
    if (promoExpiresAt > now) {
      return status === 'active' ? {} : { setStatus: 'active' };
    }
    // Expired: clear it and fall through to the normal ladder, so running out is visible in the
    // status without locking anyone out of anything.
    const rest = planTrialLifecycle({ ...input, promoExpiresAt: null });
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
   * Converted straight to a TRIAL rather than to 'free'. initTrial sets the status itself, so this is
   * one write; setting 'free' would have left them on the `lite` edition until the NEXT launch, which
   * is the same stranding this file's own tests were written to prevent. Tim's rule stands: the
   * cohort that was here first converts to trial, never to locked out.
   */
  if (status === 'lifetime') return { initTrial: true };

  // 5) The trial.
  if (!firstOpenedAt) return { initTrial: true };
  // The launch cohort: installed while billing was off, so they carry a firstOpenedAt and 'free'.
  // Their 14 days start NOW rather than at install, or the flip hands them an expired clock.
  if (status === 'free' && !trialStartedAt) return { initTrial: true };
  if (status === 'trial' && trialStartedAt && now - trialStartedAt > trialDurationMs) {
    return { setStatus: 'expired' };
  }
  return {};
}
