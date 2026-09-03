/**
 * 2026-09-03 (Tim) — "in the free period, where a user has not used it 3 times in that period, they
 * are offered a 7 day extension to play more."
 *
 * The insight is that a trial that expires unused is not a rejection, it is a MISSED trial. Golf is
 * weather, daylight and a tee time you could not get; a fortnight can pass without a round through
 * no fault of the product. Charging that player at day 14 asks them to buy something they never saw.
 * Giving them another week costs nothing — they are not a lost sale, they are a sale that has not
 * had its chance yet.
 *
 * WHAT COUNTS AS A USE. Distinct calendar DAYS on which the player did something real: started a
 * round, or recorded a swing. Deliberately NOT app opens — someone who opened the app five times in
 * a car park and never played has not used it, and would be exactly the wrong person to disqualify.
 * Deduping by day is the other half: three rounds on one Saturday is one day of use, because the
 * question being asked is "did you get out with this?", not "how many times did you tap".
 *
 * Local calendar days, not 24h blocks. A Saturday morning round and a Sunday evening range session
 * are two days to the player regardless of the hours between them.
 *
 * PURE — no stores, no dates-from-nowhere, `now` is passed in. The gathering of timestamps lives in
 * the caller, so this whole rule is a table test. [[arithmetic-belongs-in-code-not-the-model]]
 */

import type { SubscriptionStatus } from '../../store/playerProfileStore';

/** Tim's number: fewer than three days of real use means the trial did not get a fair run. */
export const LIGHT_USE_DAY_THRESHOLD = 3;
/** Tim's number: one more week to play. */
export const TRIAL_EXTENSION_DAYS = 7;
/** Offered once the trial is nearly over — early enough to matter, late enough to be true. */
export const OFFER_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;
/**
 * How long after expiry the offer is still on the table. A player whose trial lapsed while they were
 * away should still be met with the extension when they come back, not a paywall — that return is
 * the single best moment this feature has. Beyond a month it stops reading as an extension.
 */
export const LAPSED_GRACE_MS = 30 * 24 * 60 * 60 * 1000;

/** Local-calendar day key. Two timestamps on the same date collapse to one use. */
function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/**
 * Distinct local days, within [start, end], on which something happened. Timestamps outside the
 * window are ignored rather than clamped: a round played BEFORE the trial began is not trial usage,
 * and counting it would disqualify the returning player this feature exists for.
 */
export function countActiveDays(timestamps: readonly number[], start: number, end: number): number {
  const days = new Set<string>();
  for (const t of timestamps) {
    if (!Number.isFinite(t) || t < start || t > end) continue;
    days.add(dayKey(t));
  }
  return days.size;
}

export type TrialExtensionInput = {
  status: SubscriptionStatus;
  trialStartedAt: number | null;
  trialDurationMs: number;
  /** Round starts and swing sessions. Order irrelevant; duplicates harmless. */
  activityTimestamps: readonly number[];
  /** Set once the player has been given the extension — it is a one-time gesture. */
  extensionGrantedAt: number | null;
  now: number;
};

export type TrialExtensionOffer = {
  eligible: boolean;
  /** Distinct days used inside the trial window — shown to the player, so it must be the real one. */
  activeDays: number;
  /** Why not, for the debug screen and the tests. Empty string when eligible. */
  blockedBy: string;
};

/**
 * Should this player be offered another week?
 *
 * Order matters for the same reason it does in planTrialLifecycle: each early return is a population
 * we must not ask twice or ask wrongly.
 */
export function planTrialExtension(input: TrialExtensionInput): TrialExtensionOffer {
  const { status, trialStartedAt, trialDurationMs, activityTimestamps, extensionGrantedAt, now } = input;
  const no = (blockedBy: string, activeDays = 0): TrialExtensionOffer => ({ eligible: false, activeDays, blockedBy });

  // Once. A standing offer is a discount, not a gesture, and a player who takes it and still does
  // not play is telling us something we should listen to rather than re-ask.
  if (extensionGrantedAt != null) return no('already_granted');

  // Only someone actually on the trial clock. A paying subscriber has nothing to extend, and an
  // owner or comp is already unlocked — offering there would read as a downgrade.
  if (status !== 'trial' && status !== 'expired') return no('not_on_trial');
  if (!trialStartedAt) return no('no_trial_clock');

  const trialEnds = trialStartedAt + trialDurationMs;
  // Usage is counted to NOW, not to trialEnds: for a lapsed player those are different, and the
  // rounds they played are the ones inside the trial either way.
  const activeDays = countActiveDays(activityTimestamps, trialStartedAt, Math.min(now, trialEnds));

  // Too early to know. Someone on day 3 with no rounds is not a missed trial yet, they are on day 3.
  if (now < trialEnds - OFFER_WINDOW_MS) return no('too_early', activeDays);
  // Long gone. Past the grace window this is a win-back campaign, which is a different thing.
  if (now > trialEnds + LAPSED_GRACE_MS) return no('too_late', activeDays);

  // They used it. Nothing was missed, and the paywall is the honest next screen.
  if (activeDays >= LIGHT_USE_DAY_THRESHOLD) return no('used_enough', activeDays);

  return { eligible: true, activeDays, blockedBy: '' };
}

/**
 * The line the player reads. Built here so the offer card and any voice line say the same thing, and
 * so it stays honest about a number the player can check against their own round history.
 */
export function describeTrialExtension(activeDays: number): string {
  const played =
    activeDays === 0 ? "you haven't had a chance to get out with it yet"
      : activeDays === 1 ? 'you only got out once'
        : `you only got out ${activeDays} times`;
  return `Your free trial is up, but ${played}. Here's another ${TRIAL_EXTENSION_DAYS} days on us — go play.`;
}
