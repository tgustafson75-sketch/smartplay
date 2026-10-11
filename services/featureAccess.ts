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
 * The state of the switch is NOT described here. __tests__/logic/edition-matrix.test.ts pins it,
 * and that test is the statement of truth — it fails when the value changes, which prose cannot do.
 *
 * (2026-09-11: this paragraph used to assert the paywall was off and no clock was running. It had
 * been false since the switch was flipped, and it was still sitting here on the day the app shipped
 * with billing live. Deleted rather than corrected: prose that asserts runtime state goes stale
 * silently, and rewriting it only resets the clock on the next person to trust it.)
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
 * and a US link-out only. Billing runs through RevenueCat (services/billing/purchases.ts)
 * and the gates below are LIVE — SUBSCRIPTIONS_ENABLED is on and pinned by the edition-matrix test.
 * (2026-09-28: this used to say no billing SDK existed and a paid launch was blocked — false since
 * 1.0 shipped with billing on.)
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
 * Global kill-switch. FALSE = every feature unlocked and the paywall is a no-op; TRUE = the edition
 * gates below are enforced.
 */
/**
 * 2026-09-03 (Tim, launch build) — THE CLOCK STARTS.
 *
 * Flipped to true because the store listing and the Play Purchase-history declaration both describe
 * a paid app, and the binary has to match the paperwork that was filed. Both stores now hold their
 * real RevenueCat keys — the test-store key that gated this is deleted, not commented out.
 *
 * What changes for a player: starting a round stays lite forever — the front door is never walled.
 * Without Pro a player has lite and no SmartVision, SmartFinder or advanced voice, but keeps every
 * round, every stat and their bag; we do not hold a player's own data hostage.
 *
 * 2026-09-28 (1.0.2) — the app no longer grants a trial: a fresh install is 'free' (lite), and the
 * store's introductory offer, started from the plans screen, is the only trial. The light-use
 * extension is removed. Referral rewards still redeem.
 */
export const SUBSCRIPTIONS_ENABLED = true;

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
/**
 * 2026-10-10 — the edition a feature needs RIGHT NOW: the server's table (api/flags `feature_edition`,
 * the same remote switchboard as the kill switches — edited in Vercel Edge Config, no app update) over
 * the built-in FEATURE_EDITION above. Starting a round is free whatever the server says.
 */
export function effectiveEdition(feature: FeatureKey): Edition {
  if (feature === 'round_start') return 'lite';
  try {
    const remote = (require('../store/flagStore') as typeof import('../store/flagStore')).useFlagStore.getState().featureEdition?.[feature];
    if (remote === 'lite' || remote === 'pro') return remote;
  } catch { /* the built-in table */ }
  return FEATURE_EDITION[feature];
}

export function canAccess(feature: FeatureKey, status: SubscriptionStatus): boolean {
  if (!SUBSCRIPTIONS_ENABLED) return true;
  const required = effectiveEdition(feature);
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
   * The paywall promised "14-day free trial" in three separate places, read PRICING.trialDays for
   * all of them, and then this gate cut the caddie off on day 7. (2026-09-28: the paywall now reads
   * the store's offer; the constant is PRICING.legacyAppTrialDays and serves this countdown only.) It was invisible only while billing
   * was still off, and would have landed the moment the switch flipped — on the people who had just
   * paid, which is the worst possible audience for it.
   *
   * Two owners of one number, with no arbiter, exactly like the stated-yardage band. lib/pricing is
   * the source of truth (it is what the customer was shown and what the App Store Connect
   * introductory offer is set to), so it owns this too. [[two-owners-is-the-root-cause]]
   *
   * NOTE once billing is live: the STORE owns the trial clock. services/billing/purchases.ts
   * `trialDaysLeftFromCustomerInfo` reads the real expiry from the entitlement; this local count is
   * the fallback for when the store cannot be reached.
   */
  return Math.max(0, PRICING.legacyAppTrialDays - Math.floor(elapsed / (24 * 60 * 60 * 1000)));
}

/** Features in an edition — for the marketing/comparison surface, not gating. */
export function featuresIn(edition: Edition): FeatureKey[] {
  return (Object.keys(FEATURE_EDITION) as FeatureKey[])
    .filter(f => effectiveEdition(f) === 'lite' || edition === 'pro');
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
 * for.
 */
export function mayTalkToCaddie(opts?: { userInitiated?: boolean }): boolean {
  try {
    const prof = require('../store/playerProfileStore') as typeof import('../store/playerProfileStore');
    const status = prof.usePlayerProfileStore.getState().subscription_status;
    if (canAccess('voice_advanced', status)) return true;
    /**
     * 2026-09-28 (1.0.2) — THE LITE CADDIE WENT MUTE INSTEAD OF SHOWING THE PAYWALL.
     *
     * This passed triggerPaywall an EMPTY navigate ("screens own navigation"). No screen did, so off a
     * round nothing opened, askCaddie returned null, and every surface spoke its failure line — "That
     * one got away from me" — to a player whose only problem was the plan. Now a turn the PLAYER
     * started opens /paywall (off-round) or records the post-round deferral (in-round), and the
     * caller asks takeCaddiePaywallBlock() what to say. Proactive speech (the opener, presence lines)
     * passes no userInitiated and stays quietly off: a paywall thrown up by the app talking to itself
     * would be the worst possible first impression.
     */
    if (opts?.userInitiated) raiseCaddiePaywall();
    return false;
  } catch {
    // An access check must never be the reason the caddie goes quiet.
    return true;
  }
}

/**
 * 2026-09-28 (1.0.2) — the paid feature a ROUTE opens, matched by PATHNAME. Every gate that keyed on
 * the exact strings '/smartfinder' / '/smartvision' let '/smartfinder?autoread=1&mode=…' (the voice
 * intents' scene / putt / look reads) and '/smartvision?…' straight past. Query and hash are ignored.
 */
export function gatedFeatureForPath(path: string): 'smartfinder' | 'smartvision' | null {
  const pathname = String(path ?? '').split(/[?#]/)[0].replace(/\/+$/, '');
  if (pathname === '/smartfinder') return 'smartfinder';
  if (pathname === '/smartvision') return 'smartvision';
  return null;
}

/** What the caddie says when a lite player asks him something mid-round (the paywall waits). */
export const CADDIE_PAYWALL_DEFERRED_LINE =
  "That's a SmartPlay Full feature — I'll show you the plans after the round.";

/** How long a block stays readable by the surface that raised it. */
const CADDIE_BLOCK_WINDOW_MS = 10_000;
/**
 * One paywall per BURST — a surface retrying the same blocked turn (listeningSession retries
 * immediately; a blocked turn never reaches the network) must not stack a second one. 2026-09-29
 * (review): this used to be the whole 10s window, extended on every hit, so a scene/putt read that
 * raised a block nobody consumed made the NEXT blocked mic turn open nothing and say nothing.
 */
const SAME_BURST_MS = 2_000;
let caddieBlock: { at: number; deferred: boolean } | null = null;
let lastRaisedAt = 0;
let paywallOnScreen = false;

/** The paywall screen reports itself, so a turn made while it is showing does not push a second one. */
export function setPaywallOnScreen(on: boolean): void { paywallOnScreen = on; }

function raiseCaddiePaywall(): void {
  const now = Date.now();
  try {
    const guard = require('./paywallGuard') as typeof import('./paywallGuard');
    const deferred = guard.selectIsRoundActive();
    caddieBlock = { at: now, deferred };
    if (now - lastRaisedAt < SAME_BURST_MS) return;
    lastRaisedAt = now;
    if (paywallOnScreen && !deferred) return;
    void guard.triggerPaywall('voice_advanced', () => {
      try { (require('expo-router') as typeof import('expo-router')).router.push('/paywall' as never); } catch { /* no router in tests */ }
    });
  } catch { /* the gate's answer must not depend on the paywall rendering */ }
}

/**
 * Did the caddie just decline a turn because of the plan? Consumed once. `deferred` means a round is
 * on and the paywall waits for its end — say CADDIE_PAYWALL_DEFERRED_LINE; otherwise the paywall has
 * opened and the surface should say nothing (the plans screen speaks for itself).
 */
export function takeCaddiePaywallBlock(): { deferred: boolean } | null {
  if (!caddieBlock || Date.now() - caddieBlock.at > CADDIE_BLOCK_WINDOW_MS) return null;
  const b = caddieBlock;
  caddieBlock = null;
  return { deferred: b.deferred };
}

/** Test seam. Never called by the app. */
export function __resetCaddieBlockForTest(): void { caddieBlock = null; lastRaisedAt = 0; paywallOnScreen = false; }
