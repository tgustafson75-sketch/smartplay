/**
 * utils/transientRetry.ts — ONE definition of "the connection failed" vs "the server answered".
 *
 * 2026-09-03 (Tim: "don't build error states. Make it work.")
 *
 * A dropped connection on a golf course is the EXPECTED condition, not an exception. The instinct to
 * bound a request and then write the player a nicer message about having failed is the wrong one:
 * the app's job is to get the thing done anyway. So the rule everywhere is retry the connection,
 * return the answer.
 *
 * The distinction that makes it safe is what counts as transient. A wrong passphrase, a 400, a
 * payload over the cap — those are REAL ANSWERS and are returned immediately rather than hammered.
 * Only the shapes that mean "the wire, not the request" are retried.
 *
 * This lives in utils/ rather than beside its first caller because it is now the policy for several
 * unrelated surfaces (cloud backup, swing review, ball departure), and a retry policy that exists in
 * three copies will disagree in three ways the first time one of them is tightened.
 * [[two-owners-is-the-root-cause]]
 */

/** Standard backoff between attempts. Short — the player is usually watching a spinner. */
export const RETRY_BACKOFF_MS = [800, 2400];

export const waitMs = (ms: number): Promise<void> => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Does this failure describe the CONNECTION rather than the request?
 *
 * Accepts a free-form reason (an Error message, a `http_503` marker, a fetch rejection) because the
 * call sites that need this do not share a result type.
 */
export function isTransientFailure(reason: string | null | undefined): boolean {
  const r = String(reason ?? '');
  if (!r) return false;
  return r === 'timed_out'
    || /network|fetch failed|econnreset|socket hang up|timeout|aborted|http_5\d\d|http_429/i.test(r);
}

/**
 * The INFRASTRUCTURE saying "try again", as distinct from the handler saying something.
 *
 * 2026-09-03 — 500 is deliberately excluded. swingReviewEndpoint already carried a guard asserting
 * that "a 400 or a 500 is the handler talking, and repeating it would just double the work", and on
 * a 45-second analysis route that reasoning still holds: a handler that threw on this payload will
 * throw on it again, three times, for three times the server cost. 429 / 502 / 503 / 504 are the
 * opposite — they are the platform or a gateway explicitly saying the request never reached a
 * working handler, and 429 in particular means "retry after a wait" by definition.
 */
export function isInfraStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

/** Broader form: any 5xx or 429. For cheap, idempotent calls where a handler 500 is worth one more go. */
export function isTransientStatus(status: number): boolean {
  return status >= 500 || status === 429;
}

/**
 * A per-attempt abort signal that fires after `ms`, and also aborts if the CALLER's signal does.
 *
 * Deliberately not `AbortSignal.any` — that is not reliably present across the Hermes/RN versions
 * this ships on, and a diagnostic-grade helper must not be the reason a request path throws on an
 * older runtime.
 */
export function attemptSignal(ms: number, callerSignal?: AbortSignal | null): { signal: AbortSignal; done: () => void } {
  const ctrl = new AbortController();
  const timer = setTimeout(() => { try { ctrl.abort(); } catch { /* already gone */ } }, ms);
  const onCallerAbort = () => { try { ctrl.abort(); } catch { /* already gone */ } };
  if (callerSignal) {
    if (callerSignal.aborted) onCallerAbort();
    else callerSignal.addEventListener?.('abort', onCallerAbort);
  }
  return {
    signal: ctrl.signal,
    done: () => {
      clearTimeout(timer);
      try { callerSignal?.removeEventListener?.('abort', onCallerAbort); } catch { /* no-op */ }
    },
  };
}
