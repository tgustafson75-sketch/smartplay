/**
 * 2026-09-01 — ONE PLACE THAT KNOWS WHAT THE REVIEW ENDPOINT IS CALLED.
 *
 * The route was renamed from /api/cage-review to /api/swing-review for the release build, with the
 * old path kept as an alias so phones already on an OTA keep working. The mistake I made doing it was
 * shipping the CLIENT change before confirming the server route was live — which would have 404'd
 * swing review for everyone until a deploy landed, to buy a nicer name.
 *
 * So the client does not depend on deploy ordering at all. It calls the new path, and on a 404 — the
 * one status that means "this route does not exist here" — it retries the old one and remembers.
 * Nothing else is retried: a 400 or a 500 is the handler talking, and repeating it would just double
 * the work. [[the-client-must-be-the-last-to-give-up]]
 */

import { isTransientFailure, isInfraStatus, attemptSignal, waitMs, RETRY_BACKOFF_MS } from '../utils/transientRetry';

const NEW_PATH = '/api/swing-review';
const OLD_PATH = '/api/cage-review';

/** Sticky once proven, so a session pays the probe at most once. */
let resolvedPath: string | null = null;

/**
 * 2026-09-03 — BOTH fetches here were UNBOUNDED, and React Native's fetch has no default timeout.
 * Neither had a try around it either, so on a bad connection this did not fail — it HUNG, and the
 * rejection (when one eventually came) propagated to five call sites across two screens. A swing
 * review that hangs looks identical to one still working, forever.
 *
 * Bounded per attempt at 50s, which is deliberately LONGER than the route's own 45s server ceiling
 * (vercel.json): the client must not abort work the server would have finished, and a server that
 * genuinely runs to its limit still lands. [[the-client-must-be-the-last-to-give-up]]
 *
 * Retries follow Tim's rule — "don't build error states, make it work" — but only on failures that
 * fail FAST: a dropped connection, a 5xx, a 429. A TIMEOUT is deliberately not retried here, because
 * 50s means the server already exhausted its own 45s budget; repeating it cannot succeed and only
 * doubles a wait the player is watching. So the pathological case stays bounded at ~50s while a
 * flaky connection just works. [[a-budget-must-fit-what-runs-inside-it]]
 */
const REQUEST_TIMEOUT_MS = 50_000;   // > the route's 45s maxDuration, on purpose
const MAX_ATTEMPTS = 3;

/** One bounded attempt. Returns the Response, or a reason string describing why the wire failed. */
async function attempt(url: string, init: RequestInit): Promise<{ res: Response } | { reason: string }> {
  const { signal, done } = attemptSignal(REQUEST_TIMEOUT_MS, init.signal ?? null);
  try {
    const res = await fetch(url, { ...init, signal });
    return { res };
  } catch (e) {
    return { reason: e instanceof Error ? e.message : String(e) };
  } finally {
    done();
  }
}

/** Attempt `url` up to MAX_ATTEMPTS while the failure looks like the connection, not the request. */
async function fetchBounded(url: string, init: RequestInit): Promise<Response> {
  let lastReason = 'unknown';
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    if (i > 0) await waitMs(RETRY_BACKOFF_MS[i - 1] ?? 2400);
    const out = await attempt(url, init);
    if ('res' in out) {
      // 429/502/503/504 mean the request never reached a working handler. A 500 does NOT — the
      // existing guard on this module is right that a handler which threw on this payload will throw
      // on it again, and on a 45s analysis route that is three times the server cost for nothing.
      // 404 is likewise an ANSWER, and this module's whole reason for existing depends on seeing it.
      if (!isInfraStatus(out.res.status) || i === MAX_ATTEMPTS - 1) return out.res;
      lastReason = `http_${out.res.status}`;
      continue;
    }
    lastReason = out.reason;
    // A timeout at 50s means the server's own 45s budget is gone — retrying cannot beat it.
    if (!isTransientFailure(lastReason) || /abort|timeout/i.test(lastReason)) {
      throw new Error(`swing review request failed: ${lastReason}`);
    }
  }
  throw new Error(`swing review request failed after ${MAX_ATTEMPTS} attempts: ${lastReason}`);
}

/**
 * fetch the review endpoint, whichever name this server answers to. Same signature as fetch minus the
 * URL, so call sites read exactly as they did.
 */
export async function fetchSwingReview(apiUrl: string, init: RequestInit): Promise<Response> {
  const first = resolvedPath ?? NEW_PATH;
  const res = await fetchBounded(apiUrl + first, init);
  if (res.status !== 404 || first === OLD_PATH) {
    if (res.ok) resolvedPath = first;
    return res;
  }
  // 404 on the new path: this server predates the alias. Fall back and remember.
  const legacy = await fetchBounded(apiUrl + OLD_PATH, init);
  if (legacy.ok) resolvedPath = OLD_PATH;
  return legacy;
}

/** Test seam — the sticky path must not leak between cases. */
export function _resetResolvedPath(): void {
  resolvedPath = null;
}
