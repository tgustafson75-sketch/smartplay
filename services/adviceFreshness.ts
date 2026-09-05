/**
 * 2026-09-05 (Tim, from the course) — ADVICE ABOUT A SHOT YOU HAVE ALREADY HIT.
 *
 * *"I would move to my next spot, know from my yardage where I was and then hit. And then sometimes
 * by the time I get to the green, Serena was giving me my kinda layout for the shot I just hit. She
 * was right in what she said, but I had already done it by that point."*
 *
 * Note what is NOT wrong here: the answer. The caddie read the position correctly and said a
 * sensible thing. It arrived after the player had hit, walked up, and reached the green — at which
 * point a correct club recommendation for a lie he is no longer standing in is worse than silence,
 * because he has to work out which shot she means before he can ignore it.
 *
 * Latency is a separate problem and is being chased separately (background geometry builds are
 * capped at two concurrent for exactly this reason). This module is the rule that holds regardless
 * of how fast the pipeline gets: **positional advice must not be spoken after the position has
 * changed.** Even a two-second answer is wrong to say once the ball is gone.
 *
 * The epoch is hole + shots-logged, because those are the two things that make a recommendation
 * obsolete: he hit it, or he moved on. Deliberately NOT GPS distance — a player pacing around their
 * ball would trip a distance threshold while the advice is still perfectly good, and the whole point
 * is to drop advice that is WRONG, not advice that is merely late.
 *
 * Non-positional answers are untouched. "What's my handicap" is as true on the green as it was in
 * the fairway, and swallowing it would trade one silent failure for another.
 * [[feels-like-a-real-caddie]] [[caddie-failsafe-no-walls]]
 */

/** Tools whose answers are about THIS shot from THIS spot, and therefore expire when it is played. */
const POSITIONAL_TOOLS: ReadonlySet<string> = new Set([
  'recommend_club',
  'plan_shot',
  'shot_strategy',
  'aim_point',
  'layup',
]);

/**
 * A stamp of "which shot the player is standing over".
 *
 * Null when no round is active — off-course there is no position to go stale, so nothing is ever
 * suppressed on the range or at home.
 */
export function captureShotEpoch(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useRoundStore } = require('../store/roundStore') as typeof import('../store/roundStore');
    const r = useRoundStore.getState();
    if (!r.isRoundActive) return null;
    return `${r.currentHole}:${r.shots.length}`;
  } catch {
    // Never let a freshness check break a turn. Unknown epoch means "do not suppress".
    return null;
  }
}

/**
 * True when the player has hit, or changed hole, since the epoch was captured.
 *
 * A null epoch (no round when the turn started, or the store was unreadable) is never stale: this
 * may only ever SUPPRESS on positive evidence that the world moved.
 */
export function shotEpochChanged(epoch: string | null): boolean {
  if (!epoch) return false;
  const now = captureShotEpoch();
  if (!now) return false;
  return now !== epoch;
}

/** Did this turn produce advice tied to where the player was standing? */
export function isPositionalAdvice(toolActions: readonly unknown[] | null | undefined): boolean {
  if (!toolActions || toolActions.length === 0) return false;
  // BrainReply types these as unknown[], so narrow here rather than making every caller assert.
  return toolActions.some((a) => {
    const name = (a as { name?: unknown } | null | undefined)?.name;
    return typeof name === 'string' && POSITIONAL_TOOLS.has(name);
  });
}

/**
 * The decision, in one call: should this reply be spoken aloud?
 *
 * Returns false ONLY when positional advice has been overtaken by the player actually playing. The
 * caller still shows it — a real answer is never binned, per deliverBrainReply's contract — it just
 * stops being said out loud a minute after it mattered.
 */
export function adviceIsStillWorthSaying(
  epoch: string | null,
  toolActions: readonly unknown[] | null | undefined,
): boolean {
  return !(isPositionalAdvice(toolActions) && shotEpochChanged(epoch));
}

/**
 * The epoch stamped at the start of the CURRENT brain turn.
 *
 * Threading a parameter through all ten deliverBrainReply call sites would have been ten chances to
 * miss one, and the site that got missed would be the one that stayed broken. conversationalBrainTurn
 * is the single function every brain turn passes through, so it stamps here on entry and the
 * delivery path reads it. One edit, total coverage.
 */
let turnEpoch: string | null = null;

/** Called at the top of every brain turn. */
export function markAdviceTurnStart(): void {
  turnEpoch = captureShotEpoch();
}

/** The epoch captured when the in-flight turn began, or null if none was. */
export function currentTurnEpoch(): string | null {
  return turnEpoch;
}

/** Test seam — module state would otherwise leak between cases. */
export function _resetAdviceTurnEpoch(): void {
  turnEpoch = null;
}
