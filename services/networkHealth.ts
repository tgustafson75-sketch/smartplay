/**
 * 2026-05-30 — Fix FX: per-endpoint circuit-breaker.
 *
 * Three voice-path endpoints (/api/voice, /api/kevin, /api/transcribe)
 * fail loudly under weak cell coverage with no fallback. Each failure
 * wakes the cellular radio for ~10s (fetch timeout window) burning
 * battery for zero functional gain, then the NEXT call repeats the
 * cost. On a 4-hr round at the edge of cell range, this can be
 * 30-60 wasted radio wakes per round.
 *
 * This module adds a per-endpoint circuit-breaker:
 *   - Track consecutive failures per endpoint
 *   - After N consecutive failures inside WINDOW_MS, mark the endpoint
 *     "degraded" for COOLDOWN_MS
 *   - During the degraded window, callers check isEndpointDegraded()
 *     BEFORE firing the fetch and short-circuit with a synthetic
 *     failure (no radio wake)
 *   - After COOLDOWN_MS, attempts resume; first success clears the flag
 *
 * Conservative design choices:
 *   - PURELY ADDITIVE — existing fetch error paths unchanged
 *   - Per-endpoint state so one bad service doesn't block the others
 *     (e.g. /api/voice down doesn't suppress /api/kevin attempts)
 *   - Mark events bypass: callers can pass { force: true } to ignore
 *     the breaker (use for hero / user-initiated retries)
 *   - State is in-memory only (resets on app restart). The right
 *     half-life for "network came back" is uncertain enough that
 *     persisting feels premature.
 *   - No UI surface yet — Tim's call: "the real question is do we
 *     have a cleaner low power mode" — badge is the wrong framing;
 *     Local Mode (proposed separately) is the right framing.
 */

const N_FAILURES_TO_TRIP = 3;
const FAILURE_WINDOW_MS = 30_000;
const COOLDOWN_MS = 60_000;

export type NetworkEndpoint = 'voice' | 'kevin' | 'transcribe';

interface EndpointState {
  /** Timestamps of recent failures (within FAILURE_WINDOW_MS). */
  failures: number[];
  /** When the circuit tripped, if currently degraded. null when healthy. */
  trippedAt: number | null;
}

const state: Record<NetworkEndpoint, EndpointState> = {
  voice:      { failures: [], trippedAt: null },
  kevin:      { failures: [], trippedAt: null },
  transcribe: { failures: [], trippedAt: null },
};

/**
 * Should the caller SKIP the fetch entirely? Returns true during the
 * cooldown window after a trip. Callers honor this by short-circuiting
 * to whatever their existing failure path is — without firing the
 * actual fetch and wasting a radio wake.
 *
 * Pass { force: true } from user-initiated retry paths (e.g. a Try
 * Again button) to ignore the breaker and probe the network again.
 */
export function isEndpointDegraded(endpoint: NetworkEndpoint, opts?: { force?: boolean }): boolean {
  if (opts?.force) return false;
  const s = state[endpoint];
  if (!s.trippedAt) return false;
  if (Date.now() - s.trippedAt < COOLDOWN_MS) return true;
  // Cooldown expired — clear and allow attempts to resume.
  s.trippedAt = null;
  s.failures = [];
  return false;
}

/**
 * Record the outcome of a fetch. Success clears the failure history;
 * failure appends a timestamp and trips the circuit if N failures
 * have accumulated inside FAILURE_WINDOW_MS.
 */
export function recordFetchOutcome(endpoint: NetworkEndpoint, ok: boolean): void {
  const s = state[endpoint];
  const now = Date.now();
  if (ok) {
    if (s.failures.length > 0 || s.trippedAt) {
      console.log(`[networkHealth] ${endpoint} recovered (had ${s.failures.length} recent failures)`);
    }
    s.failures = [];
    s.trippedAt = null;
    return;
  }
  // Prune failures older than the window.
  s.failures = s.failures.filter(t => now - t < FAILURE_WINDOW_MS);
  s.failures.push(now);
  if (s.failures.length >= N_FAILURES_TO_TRIP && !s.trippedAt) {
    s.trippedAt = now;
    console.log(`[networkHealth] ${endpoint} TRIPPED (${s.failures.length} failures in ${FAILURE_WINDOW_MS}ms; cooldown ${COOLDOWN_MS}ms)`);
  }
}

/**
 * Diagnostic snapshot. Owner debug surface can render this to confirm
 * the breaker is doing what it claims.
 */
export function getNetworkHealthSnapshot(): Record<NetworkEndpoint, {
  recentFailures: number;
  degraded: boolean;
  cooldownRemainingMs: number;
}> {
  const now = Date.now();
  const snap = {} as Record<NetworkEndpoint, {
    recentFailures: number;
    degraded: boolean;
    cooldownRemainingMs: number;
  }>;
  (['voice', 'kevin', 'transcribe'] as const).forEach(ep => {
    const s = state[ep];
    snap[ep] = {
      recentFailures: s.failures.filter(t => now - t < FAILURE_WINDOW_MS).length,
      degraded: !!s.trippedAt && now - s.trippedAt < COOLDOWN_MS,
      cooldownRemainingMs: s.trippedAt
        ? Math.max(0, COOLDOWN_MS - (now - s.trippedAt))
        : 0,
    };
  });
  return snap;
}

/**
 * Test-only / owner-tool reset. Clears all breaker state immediately
 * so the next fetch attempt fires regardless of prior failures.
 */
export function _resetNetworkHealth(): void {
  (['voice', 'kevin', 'transcribe'] as const).forEach(ep => {
    state[ep] = { failures: [], trippedAt: null };
  });
}
