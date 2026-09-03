import { type SubscriptionStatus } from '../store/playerProfileStore';
import { PRICING } from '../lib/pricing';

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
  | 'smartfinder';

/**
 * The two editions. `SubscriptionStatus` describes BILLING state ('trial',
 * 'expired', 'active', 'free', 'lifetime'); `Edition` describes what the player
 * can DO. Keeping them separate is the point — conflating them is what made the
 * old boolean unable to express a free tier that still works.
 */
/**
 * 2026-08-30 — 'full' RENAMED TO 'pro', because three layers were using three names for one thing.
 *
 * The player reads "Pro" in all eight places it appears — the paywall card, the About row, the
 * support-email subject, the scorecard footer and the caddie's own "part of the Pro plan" lines.
 * RevenueCat's entitlement is `smartplay_caddie_pro`. Only this type still said "full", so a reader
 * had to hold Pro / Full / full in their head and decide which two meant the same thing. They all
 * did. [[two-owners-is-the-root-cause]]
 *
 * 'lite' keeps its name: it is internal only and no player ever sees the word.
 */
export type Edition = 'lite' | 'pro';

/**
 * Global kill-switch. FALSE = every feature unlocked, no trial, paywall is a
 * no-op. Flip to true only alongside a real IAP integration (RevenueCat is the
 * standard wrapper) — and only when Tim says the clock may start.
 */
export const SUBSCRIPTIONS_ENABLED = false;

/**
 * 2026-09-03 (Tim, final build) — HEALTH CONNECT IS OUT OF 1.0.
 *
 * The Play Health declaration filed for this release says the app has no health features. The
 * binary must match that exactly: undeclared health-data collection is a hard rejection, and the
 * Health Connect data-access declaration is the slowest review item there is. So the four
 * android.permission.health.* entries, the react-native-health-connect plugin and the API-34
 * rationale plugin are all removed from app.json for this build.
 *
 * The CODE stays. services/healthData, the round-effort reader and the recap "THE WALK" card were
 * all built today and are correct; without the permissions they simply never see data —
 * describeRoundEffort already returns null for a round with no watch reading, which is the common
 * case anyway. Nothing is orphaned in the sense this project means it: the reader has a caller, the
 * caller has a surface, and the surface renders when there is something to render.
 *
 * This flag exists so a SURFACE THAT PROMISES the feature can be hidden alongside it. A tutorial
 * card explaining how to connect Health Connect, in a build that cannot, is the app lying to
 * someone who went looking for help — the same reason the free-trial card is gated.
 * Flip to true in 1.1 together with the app.json entries and the filed declaration.
 */
export const HEALTH_CONNECT_ENABLED = false;

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
  smartvision: 'pro',
  smartfinder: 'pro',
  cage_mode: 'pro',
  voice_advanced: 'pro',
  // Human coaching time, not inference — the most expensive thing here.
};

/** Billing states that grant the Pro edition once subscriptions are live. */
const PRO_STATUSES: readonly SubscriptionStatus[] = ['active', 'trial', 'lifetime'];

/**
 * The edition a billing status grants.
 *
 * Note 'expired' and 'free' both land on 'lite' rather than on nothing. An
 * expired subscriber keeps their scorecard, their history and their bag — we
 * never take a player's own data hostage. They lose the caddie, not the round.
 */
export function editionFor(status: SubscriptionStatus): Edition {
  if (!SUBSCRIPTIONS_ENABLED) return 'pro';
  return PRO_STATUSES.includes(status) ? 'pro' : 'lite';
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
  return required === 'lite' || editionFor(status) === 'pro';
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
  /**
   * 2026-08-29 — WAS A HARDCODED 7, AND lib/pricing.ts SAYS 14.
   *
   * The paywall promises "14-day free trial" in three separate places, reads PRICING.trialDays for
   * all of them, and then this gate cut the caddie off on day 7. Invisible only because
   * SUBSCRIPTIONS_ENABLED is false — it would have landed the moment the switch flipped, on the
   * people who had just paid, which is the worst possible audience for it.
   *
   * Two owners of one number, with no arbiter, exactly like the stated-yardage band. lib/pricing is
   * the source of truth (it is what the customer was shown and what the App Store Connect
   * introductory offer is set to), so it owns this too. [[two-owners-is-the-root-cause]]
   *
   * NOTE once billing is live: the STORE owns the trial clock. services/billing/purchases.ts
   * `trialDaysLeftFromCustomerInfo` reads the real expiry from the entitlement; this local count is
   * the fallback for when the store cannot be reached.
   */
  return Math.max(0, PRICING.trialDays - Math.floor(elapsed / (24 * 60 * 60 * 1000)));
}

/** Features in an edition — for the marketing/comparison surface, not gating. */
export function featuresIn(edition: Edition): FeatureKey[] {
  return (Object.keys(FEATURE_EDITION) as FeatureKey[])
    .filter(f => FEATURE_EDITION[f] === 'lite' || edition === 'pro');
}

/**
 * 2026-08-25 (pre-submission tier audit) — THE ONE GATE FOR TALKING TO THE CADDIE.
 *
 * `voice_advanced` was declared as a paid feature and enforced at ZERO call sites, so throwing
 * SUBSCRIPTIONS_ENABLED would have left the single most expensive thing in the app — the brain
 * itself — free forever, silently. Nothing fails when a gate is merely absent.
 *
 * WHY THIS IS A SHARED HELPER AND NOT A REFACTOR. Five modules build caddie payloads: caddieBrain
 * ("ONE CALL TO THE CADDIE"), conversationalBrain ("EVERY MIC, ONE CADDIE"), presenceCaddie,
 * listeningSession and sceneReadService. Consolidating them behind a single sender is the right
 * end state and is the tail of the "one caddie, one payload" work — but it is a large change to the
 * hottest path in the app, and this is submission week. Gating SOME of them would be worse than
 * none: a Lite player who reaches the caddie through one mic and not another has a bug, not a
 * paywall. So: one owner for the decision, called by all five, with a sim guard that fails if any
 * sender stops calling it.
 *
 * DEGRADES, NEVER GOES DARK. A blocked turn raises the paywall rather than returning silence — a
 * caddie that simply stops answering reads as broken, which is the opposite of what a paywall is
 * for. Inert today: SUBSCRIPTIONS_ENABLED is false, so this returns true for everyone.
 */
export function mayTalkToCaddie(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const prof = require('../store/playerProfileStore') as typeof import('../store/playerProfileStore');
    const status = prof.usePlayerProfileStore.getState().subscription_status;
    if (canAccess('voice_advanced', status)) return true;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { triggerPaywall } = require('./paywallGuard') as typeof import('./paywallGuard');
      // No navigate function here — the paywall guard defers to the round-aware path, and the
      // screens that own navigation raise it themselves. This is the signal, not the UI.
      void triggerPaywall('voice_advanced', () => { /* screens own navigation */ });
    } catch { /* the gate's answer must not depend on the paywall rendering */ }
    return false;
  } catch {
    // An access check must never be the reason the caddie goes quiet.
    return true;
  }
}
