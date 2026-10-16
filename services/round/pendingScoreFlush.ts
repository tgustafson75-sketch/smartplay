/**
 * 2026-09-30 (triple-check of the strip-scoring fix) — A SCORE STILL BEING TAPPED IN IS PART OF THE ROUND.
 *
 * The caddie data strip holds its SCORE/PUTTS taps as one pending entry for 2.5s before writing, so
 * "+ +" cannot walk the round across two holes. An End Round inside that window ran endRound first;
 * the entry then committed into a dead round and was dropped — the last hole's score missing from the
 * recap and the saved record. Whoever holds a pending entry registers a flush here; endRound (every
 * caller: button, voice, auto-end) flushes before it snapshots anything. Zero deps, so the store can
 * import it without a cycle.
 */
/**
 * 2026-10-15 (review) — SEVERAL holders, not one. The caddie strip and the cockpit stepper both hold
 * a settling score; with a single slot the later registration silently replaced the earlier one, so
 * only one surface's pending entry could ever be flushed by End Round.
 */
const flushFns = new Set<() => void>();

/** The holder registers its flush; the returned function unregisters it. */
export function registerPendingScoreFlush(fn: () => void): () => void {
  flushFns.add(fn);
  return () => { flushFns.delete(fn); };
}

/** Write every pending score entry now. Safe to call with nothing pending. */
export function flushPendingScores(): void {
  for (const fn of Array.from(flushFns)) {
    try { fn(); } catch { /* a flush must never block ending the round */ }
  }
}
