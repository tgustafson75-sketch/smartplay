/**
 * 2026-06-07 — Voice/network circuit breaker.
 *
 * Tim's Echo Hills round produced ~28 consecutive voice-path failures
 * during weak-signal stretches. Each tap paid the full 10-30s
 * radio-wake-and-timeout cost before falling through to a fallback or
 * surfacing an error. The behavior is documented in
 * services/voiceService.ts header but was never implemented.
 *
 * This module: tracks per-endpoint failure counts in a rolling 30s
 * window. When an endpoint hits THRESHOLD consecutive failures, it's
 * marked DEGRADED for DEGRADED_MS — subsequent calls check
 * isDegraded() and short-circuit BEFORE firing the fetch. On the
 * first degradation in a session we also auto-engage Local Mode so
 * the user gets the cheapest/most-local path going forward.
 *
 * Consumers call recordSuccess() on 2xx, recordFailure() on any
 * fetch error or non-2xx response. Endpoints are scoped so a /api/voice
 * blip doesn't kill /api/transcribe.
 *
 * When signal returns and the user explicitly re-engages (e.g. taps
 * to retry), they can manually flip Local Mode off via Settings; the
 * breaker self-clears after DEGRADED_MS regardless.
 */

const FAILURE_WINDOW_MS = 30_000;
const FAILURE_THRESHOLD = 3;
const DEGRADED_MS = 60_000;

// 2026-06-07 (audit) — added 'swing-analysis' so weak-signal range
// sessions short-circuit instead of paying full timeout+retry per swing.
export type VoiceEndpoint = 'voice' | 'kevin' | 'transcribe' | 'voice-intent' | 'swing-analysis';

// 2026-06-09 — Why the endpoint failed, so the breaker can react honestly.
//   'network' — genuine connectivity loss (offline, DNS, connection refused).
//               THIS is the only kind that means "weak signal" → Local Mode.
//   'timeout' — the SERVER took longer than our client deadline. On good
//               Wi-Fi this is server slowness, NOT a network loss. Must not
//               flip the offline banner or auto-engage Local Mode.
//   'server'  — the server answered with a 5xx. Also not a network problem.
export type FailureKind = 'network' | 'timeout' | 'server';

const failures: Record<VoiceEndpoint, number[]> = {
  voice: [],
  kevin: [],
  transcribe: [],
  'voice-intent': [],
  'swing-analysis': [],
};
const degradedUntil: Record<VoiceEndpoint, number> = {
  voice: 0,
  kevin: 0,
  transcribe: 0,
  'voice-intent': 0,
  'swing-analysis': 0,
};
// Dominant failure reason per endpoint (last recorded). Lets consumers
// surface honest copy on a short-circuit: a timeout-driven trip should say
// "analyzer is catching up", a network-driven trip "lost connection".
const lastReason: Record<VoiceEndpoint, FailureKind> = {
  voice: 'network',
  kevin: 'network',
  transcribe: 'network',
  'voice-intent': 'network',
  'swing-analysis': 'network',
};
// 2026-06-10 — Local Mode is no longer auto-engaged by the breaker (it caused
// a permanent false "cell signal weak" trap on good connectivity). It is a
// user-controlled setting only. Kept as a constant-false for the diagnostic
// snapshot's shape.
const localModeAutoEngaged = false;

/**
 * Record a failure for the given endpoint. If THRESHOLD failures land
 * within the rolling window, the endpoint is marked degraded for
 * DEGRADED_MS and Local Mode is auto-engaged.
 */
export function recordFailure(endpoint: VoiceEndpoint, kind: FailureKind = 'network'): void {
  const now = Date.now();
  lastReason[endpoint] = kind;
  const recent = failures[endpoint].filter(t => now - t < FAILURE_WINDOW_MS);
  recent.push(now);
  failures[endpoint] = recent;
  if (recent.length >= FAILURE_THRESHOLD && degradedUntil[endpoint] < now) {
    degradedUntil[endpoint] = now + DEGRADED_MS;
    failures[endpoint] = [];
    console.log(`[circuit-breaker] ${endpoint} ${kind} failures tracked (telemetry only — NOT blocking)`);
    // 2026-06-10 — REMOVED auto-engage of Local Mode. Auto-flipping a
    // PERSISTENT user setting from a transient breaker trip was the bug behind
    // a false weak-signal Local-Mode toast appearing on perfect Wi-Fi and then
    // never reverting (a permanent trap until a manual Settings toggle). Local
    // Mode is now a user choice only. The breaker no longer flips it.
  }
}

/** Dominant reason the endpoint last failed — null when not degraded. */
export function degradedReason(endpoint: VoiceEndpoint): FailureKind | null {
  return isDegraded(endpoint) ? lastReason[endpoint] : null;
}

/**
 * Record a success. Clears the failure window for the endpoint so a
 * transient blip doesn't compound into a trip.
 */
export function recordSuccess(endpoint: VoiceEndpoint): void {
  failures[endpoint] = [];
  // 2026-06-07 (audit) — any successful network call means we're online;
  // clear the reactive offline banner. Dynamic require avoids a cycle.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const c = require('../store/connectivityStore') as typeof import('../store/connectivityStore');
    c.reportOnline();
  } catch { /* non-fatal */ }
}

/**
 * 2026-06-10 — FAIL-SAFE: the caddie ALWAYS attempts the real call.
 *
 * This used to return true after 3 failures and callers would short-circuit
 * the fetch — which produced false weak-signal "voice paused" / "no
 * network" walls on perfect Wi-Fi (one cold-start or transient blip tripped
 * it, and because it then stopped TRYING, a success could never clear it
 * inside the window). That is the opposite of resilient.
 *
 * Now it always returns false: every user-initiated call goes through. Each
 * real call already has its own timeout AND a graceful fallback (local status
 * replies on-course, a brief honest line otherwise), so a genuine outage
 * degrades softly instead of being pre-blocked. Failure counts are still
 * recorded above for /owner-logs telemetry — they just never gate the user.
 */
export function isDegraded(_endpoint: VoiceEndpoint): boolean {
  return false;
}

/**
 * Diagnostic snapshot for /owner-logs.
 */
export function getCircuitBreakerSnapshot(): {
  degraded: Record<VoiceEndpoint, boolean>;
  failureCount: Record<VoiceEndpoint, number>;
  localModeAutoEngaged: boolean;
} {
  const now = Date.now();
  return {
    degraded: {
      voice: now < degradedUntil.voice,
      kevin: now < degradedUntil.kevin,
      transcribe: now < degradedUntil.transcribe,
      'voice-intent': now < degradedUntil['voice-intent'],
      'swing-analysis': now < degradedUntil['swing-analysis'],
    },
    failureCount: {
      voice: failures.voice.length,
      kevin: failures.kevin.length,
      transcribe: failures.transcribe.length,
      'voice-intent': failures['voice-intent'].length,
      'swing-analysis': failures['swing-analysis'].length,
    },
    localModeAutoEngaged,
  };
}

/**
 * Reset state — used by tests + when user explicitly recovers (e.g.
 * disables Local Mode in Settings indicating they think cell is back).
 */
export function resetCircuitBreaker(): void {
  for (const k of Object.keys(failures) as VoiceEndpoint[]) {
    failures[k] = [];
    degradedUntil[k] = 0;
  }
}
