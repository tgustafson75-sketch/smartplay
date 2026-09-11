/**
 * 2026-09-11 — ONE HEDGED RACE, used by both mic owners.
 *
 * A hung socket and a slow-but-working one are indistinguishable while you wait, so the transcribe
 * paths stopped betting on a timeout and started racing: open a second connection after a short
 * delay and take the first answer. That was right, and it was implemented twice — once in
 * voiceService.captureUtterance (earbud + text-box mic) and once in useVoiceCaddie (the tap path).
 * The sim carries a LOCK requiring those two entry points to fail the same way, precisely because
 * they keep drifting apart.
 *
 * Both copies also LEAKED. Each built an AbortController inside its own fetch helper and kept it
 * private, so once `Promise.any` settled nothing cancelled the loser: on a healthy turn answering in
 * ~1.2s the hedge still woke at 2.5s and POSTed the same audio again. The tap path did it inside a
 * two-budget retry loop, so one spoken sentence could cost four uploads and four transcriptions off
 * a phone on cell data. The comment there claimed "one duplicate upload on a slow turn only"; it was
 * every turn.
 *
 * So the race lives here, once, and it cancels what it does not need:
 *   • the hedge timer is cleared the moment the primary answers — the second connection is never
 *     opened at all on a healthy turn;
 *   • if the hedge did open and the primary wins anyway, the hedge is aborted;
 *   • aborting an attempt that already completed is a no-op, so the winner is never disturbed.
 *
 * [[two-owners-is-the-root-cause]] [[no-half-fixes-enforce-every-surface]]
 */

/** One cancellable attempt. `abort` must be safe to call at any time, including after completion. */
export interface HedgeAttempt<T> {
  result: Promise<T>;
  abort: () => void;
}

/**
 * Run `attempt`, and if it has not answered within `hedgeMs`, run a second one and take whichever
 * answers first. Rejects only when BOTH fail (an AggregateError from Promise.any).
 */
export async function raceHedged<T>(
  attempt: (isHedge: boolean) => HedgeAttempt<T>,
  hedgeMs: number,
): Promise<T> {
  const primary = attempt(false);
  primary.result.catch(() => {});

  /**
   * Which attempt produced the value we return. The winner must NEVER be aborted: Promise.any
   * resolves as soon as the Response HEADERS arrive, and the caller reads the body afterwards
   * (`res.json()`), so aborting the winner here would tear the body stream out from under it and
   * turn a successful transcribe into a thrown error. Only the loser is cancelled.
   */
  const state: {
    settled: boolean;
    abortHedge: (() => void) | null;
    hedgeStarted: boolean;
    winner: 'primary' | 'hedge' | null;
  } = { settled: false, abortHedge: null, hedgeStarted: false, winner: null };
  let timer: ReturnType<typeof setTimeout> | null = null;

  const primaryTagged = primary.result.then((v) => { state.winner ??= 'primary'; return v; });
  primaryTagged.catch(() => {});

  const hedged = new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => {
      // The primary already answered — do not open a second connection at all.
      if (state.settled) { reject(new Error('hedge_not_needed')); return; }
      state.hedgeStarted = true;
      const alt = attempt(true);
      state.abortHedge = alt.abort;
      alt.result.then((v) => { state.winner ??= 'hedge'; resolve(v); }, reject);
    }, hedgeMs);
  });
  hedged.catch(() => {});

  try {
    return await Promise.any([primaryTagged, hedged]);
  } finally {
    state.settled = true;
    if (timer) clearTimeout(timer);
    // Cancel only the connection whose answer we are not using. Aborting an attempt that already
    // completed is a no-op, but the winner's body is still being read — so it is left alone.
    if (state.winner === 'hedge') primary.abort();
    else if (state.hedgeStarted) state.abortHedge?.();
  }
}
