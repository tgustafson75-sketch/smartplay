import { type SubscriptionStatus } from '../store/playerProfileStore';

/**
 * ── EDITION ACCESS ───────────────────────────────────────────────────────────
 *
 * 2026-08-19. Rewritten to be able to EXPRESS a Lite/Full split. It previously
 * could not: `canAccess` was `status === 'active' || 'trial' || 'lifetime'` for
 * every feature, so all three paid states granted an identical, all-or-nothing
 * bundle and there was no free tier at all. "Finalising the differences between
 * the lite and full versions" was therefore not a reconciliation job — the
 * distinction did not exist anywhere in the code.
 *
 * ⚠️ NOTHING IS GATED TODAY, AND NO CLOCK IS RUNNING. ⚠️
 *
 * Tim, 2026-08-19: "don't put the paywall in for testers yet or start a 30 day
 * clock." `SUBSCRIPTIONS_ENABLED` stays false, so:
 *   - `canAccess()` returns true for every feature, in every state
 *   - `trialDaysLeft()` returns null and no trial timer is consulted or started
 *   - the paywall route renders nothing
 * `__tests__/logic/edition-matrix.test.ts` pins all of that. This file is the
 * MECHANISM, built and tested behind the switch, so turning it on later is a
 * one-line change rather than a refactor under deadline pressure.
 *
 * WHERE THE LINE IS DRAWN (decided 2026-08-19)
 * --------------------------------------------
 * Lite is free and costs us nothing per user. Full is everything that spends
 * inference on someone's behalf. That is not an arbitrary split — it is the only
 * one where the wall sits exactly on our marginal cost, which also makes it the
 * easiest story to defend in App Store review and the easiest to explain to a
 * player: you pay for the caddie, not for the scorecard.
 *
 *   LITE  GPS yardages, scorecard + round tracking, bag, course book, history
 *   FULL  the voice caddie, SmartMotion/Cage analysis, SmartVision, SmartFinder,
 *         TightLie, coaching, and human review
 *
 * BILLING CONSTRAINT — read before wiring anything to money
 * --------------------------------------------------------
 * App Store guideline 3.1.1: in-app digital subscriptions REQUIRE Apple IAP.
 * Stripe inside the app is a rejection. Stripe is correct for web/direct sales
 * and a US link-out only. No billing SDK exists in this project today, so a paid
 * launch is blocked on that regardless of what this file says.
 */

/** A capability that can be gated. */
export type FeatureKey =
  | 'round_start'
  | 'smartvision'
  | 'cage_mode'
  | 'voice_advanced'
  | 'smartfinder'
  | 'send_to_tank';

/**
 * The two editions. `SubscriptionStatus` describes BILLING state ('trial',
 * 'expired', 'active', 'free', 'lifetime'); `Edition` describes what the player
 * can DO. Keeping them separate is the point — conflating them is what made the
 * old boolean unable to express a free tier that still works.
 */
export type Edition = 'lite' | 'full';

/**
 * Global kill-switch. FALSE = every feature unlocked, no trial, paywall is a
 * no-op. Flip to true only alongside a real IAP integration (RevenueCat is the
 * standard wrapper) — and only when Tim says the clock may start.
 */
export const SUBSCRIPTIONS_ENABLED = false;

/**
 * Which edition each feature requires.
 *
 * Exhaustively typed on FeatureKey on purpose: adding a feature to FeatureKey
 * without deciding its edition is a compile error, not a silent default. A
 * silent default is how a paid feature ends up free, or — worse — how a free
 * feature ends up behind a wall nobody meant to build.
 */
export const FEATURE_EDITION: Record<FeatureKey, Edition> = {
  // ── LITE — no per-user inference cost ──
  // Starting a round is the product's front door. Putting it behind a wall (as
  // the old scaffolding did) means a new player cannot experience anything at
  // all before paying, which is both a bad funnel and a hard App Store review
  // conversation.
  round_start: 'lite',

  // ── FULL — every one of these spends inference per use ──
  smartvision: 'full',
  smartfinder: 'full',
  cage_mode: 'full',
  voice_advanced: 'full',
  // Human coaching time, not inference — the most expensive thing here.
  send_to_tank: 'full',
};

/** Billing states that grant the Full edition once subscriptions are live. */
const FULL_STATUSES: readonly SubscriptionStatus[] = ['active', 'trial', 'lifetime'];

/**
 * The edition a billing status grants.
 *
 * Note 'expired' and 'free' both land on 'lite' rather than on nothing. An
 * expired subscriber keeps their scorecard, their history and their bag — we
 * never take a player's own data hostage. They lose the caddie, not the round.
 */
export function editionFor(status: SubscriptionStatus): Edition {
  if (!SUBSCRIPTIONS_ENABLED) return 'full';
  return FULL_STATUSES.includes(status) ? 'full' : 'lite';
}

/**
 * Can this player use this feature?
 *
 * While SUBSCRIPTIONS_ENABLED is false this returns true unconditionally — the
 * ~12 call sites across the app behave exactly as they do today.
 */
export function canAccess(feature: FeatureKey, status: SubscriptionStatus): boolean {
  if (!SUBSCRIPTIONS_ENABLED) return true;
  const required = FEATURE_EDITION[feature];
  return required === 'lite' || editionFor(status) === 'full';
}

/**
 * Days left in a trial, or null.
 *
 * Returns null while subscriptions are off — no clock is consulted and none is
 * started. Tim's 2026-08-19 instruction, enforced here rather than left to each
 * caller to remember.
 */
export function trialDaysLeft(trial_started_at: number | null): number | null {
  if (!SUBSCRIPTIONS_ENABLED) return null;
  if (!trial_started_at) return null;
  const elapsed = Date.now() - trial_started_at;
  return Math.max(0, 7 - Math.floor(elapsed / (24 * 60 * 60 * 1000)));
}

/** Features in an edition — for the marketing/comparison surface, not gating. */
export function featuresIn(edition: Edition): FeatureKey[] {
  return (Object.keys(FEATURE_EDITION) as FeatureKey[])
    .filter(f => FEATURE_EDITION[f] === 'lite' || edition === 'full');
}
