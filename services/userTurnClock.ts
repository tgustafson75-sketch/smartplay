/**
 * 2026-09-28 (Tim — "a first ask of the caddie delay and … some racing or missing voice") — WHEN DID
 * THE PLAYER LAST START TALKING TO US?
 *
 * Proactive speech (the app-open opener, the first-tee handoff, hole-change lines) asks the brain
 * for a line and speaks it when it comes back — up to 12s later. Every one of those paths checked
 * "is anything playing?" BEFORE the await and nothing after it, so the player's first tap landed
 * inside the gap and the late line arrived on top of their turn: over the recording, ahead of or
 * after the answer, and (for the opener) wiping the first exchange out of the shared history.
 *
 * The fix is one question asked after every such await: has the player started a turn since I began?
 * An epoch answers it without tracking when turns END, which is where every earlier "is a turn
 * active" flag went stale. Zero deps, so any module can import it.
 */
let epoch = 0;
let lastAt = 0;

/** A player turn has started: mic opened, VAD fired, text submitted. Call before any await. */
export function noteUserTurn(): void {
  epoch += 1;
  lastAt = Date.now();
}

/** Monotonic count of player turns this process. Capture before an await, compare after. */
export function getUserTurnEpoch(): number {
  return epoch;
}

/** ms since the player last started a turn, or null if they have not this process. */
export function msSinceUserTurn(): number | null {
  return lastAt ? Date.now() - lastAt : null;
}

/** Test seam. Never called by the app. */
export function __resetUserTurnClockForTest(): void {
  epoch = 0;
  lastAt = 0;
}
