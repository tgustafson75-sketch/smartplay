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

export type VoiceEndpoint = 'voice' | 'kevin' | 'transcribe' | 'voice-intent';

const failures: Record<VoiceEndpoint, number[]> = {
  voice: [],
  kevin: [],
  transcribe: [],
  'voice-intent': [],
};
const degradedUntil: Record<VoiceEndpoint, number> = {
  voice: 0,
  kevin: 0,
  transcribe: 0,
  'voice-intent': 0,
};
// Track whether we've already auto-engaged Local Mode this session so we
// don't toast twice (or fight a user who manually turned it off).
let localModeAutoEngaged = false;

function maybeAutoEngageLocalMode(triggeringEndpoint: VoiceEndpoint): void {
  if (localModeAutoEngaged) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const settingsMod = require('../store/settingsStore') as typeof import('../store/settingsStore');
    const s = settingsMod.useSettingsStore.getState();
    if (!s.localMode) {
      s.setLocalMode(true);
      localModeAutoEngaged = true;
      console.log(`[circuit-breaker] auto-engaged Local Mode after ${triggeringEndpoint} degradation`);
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const toastMod = require('../store/toastStore') as typeof import('../store/toastStore');
        toastMod.useToastStore.getState().show('Cell signal weak — Local Mode on');
      } catch { /* non-fatal */ }
    }
  } catch (e) {
    console.log('[circuit-breaker] localMode auto-engage failed (non-fatal):', e);
  }
}

/**
 * Record a failure for the given endpoint. If THRESHOLD failures land
 * within the rolling window, the endpoint is marked degraded for
 * DEGRADED_MS and Local Mode is auto-engaged.
 */
export function recordFailure(endpoint: VoiceEndpoint): void {
  const now = Date.now();
  const recent = failures[endpoint].filter(t => now - t < FAILURE_WINDOW_MS);
  recent.push(now);
  failures[endpoint] = recent;
  if (recent.length >= FAILURE_THRESHOLD && degradedUntil[endpoint] < now) {
    degradedUntil[endpoint] = now + DEGRADED_MS;
    failures[endpoint] = [];
    console.log(`[circuit-breaker] ${endpoint} marked DEGRADED for ${DEGRADED_MS / 1000}s after ${FAILURE_THRESHOLD} failures in ${FAILURE_WINDOW_MS / 1000}s`);
    maybeAutoEngageLocalMode(endpoint);
  }
}

/**
 * Record a success. Clears the failure window for the endpoint so a
 * transient blip doesn't compound into a trip.
 */
export function recordSuccess(endpoint: VoiceEndpoint): void {
  failures[endpoint] = [];
}

/**
 * True when the endpoint is currently marked degraded. Callers should
 * short-circuit the fetch and return a fallback IMMEDIATELY instead
 * of paying the radio-wake cost.
 */
export function isDegraded(endpoint: VoiceEndpoint): boolean {
  if (Date.now() >= degradedUntil[endpoint]) {
    // Auto-clear so subsequent calls go through; success path will
    // then reset failures via recordSuccess.
    if (degradedUntil[endpoint] !== 0) {
      degradedUntil[endpoint] = 0;
      console.log(`[circuit-breaker] ${endpoint} degraded window expired — clear`);
    }
    return false;
  }
  return true;
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
    },
    failureCount: {
      voice: failures.voice.length,
      kevin: failures.kevin.length,
      transcribe: failures.transcribe.length,
      'voice-intent': failures['voice-intent'].length,
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
  localModeAutoEngaged = false;
}
