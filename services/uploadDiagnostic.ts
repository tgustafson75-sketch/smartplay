/**
 * Phase BQ — Upload pipeline diagnostic helper.
 *
 * Emits structured `[upload:<stage>]` markers at every pipeline transition
 * with a duration delta since the previous marker for the same session.
 * Used alongside the existing `[V6-DIAG]` markers (which cover the deep
 * pose-detection pipeline) to fill the front-of-pipeline + UI-render
 * gaps that V6-DIAG didn't instrument.
 *
 * Greppable via `adb logcat | grep upload:` — all markers share the
 * `[upload:` prefix so the trace surfaces in one filter.
 *
 * Per BQ Component 2 spec, every event includes:
 *   - Timestamp (ms since epoch)
 *   - Stage name
 *   - Success/failure status (callers pass status: 'ok'|'failed' in data)
 *   - Error message (callers pass message in data when failed)
 *   - Duration since previous stage for the same session
 *   - Relevant metadata (file size, duration, frame count, etc.)
 */

import { track } from './analytics';

type StageData = Record<string, unknown> | undefined;

/** Per-session timing registry. Keyed by sessionId or 'pre-session' for
 *  pickVideo/probeVideo events that fire before a sessionId exists. */
const lastTsByKey = new Map<string, number>();
const sessionStartTs = new Map<string, number>();

/**
 * Emit a `[upload:<stage>]` marker. Pass `key` to scope the duration delta
 * to a particular session — for events before ingest, use 'pre-session'
 * (default). The first call for a key resets the clock; subsequent calls
 * include `delta_ms` since the previous call.
 */
export function uploadLog(
  stage: string,
  data?: StageData,
  key: string = 'pre-session',
): void {
  const now = Date.now();
  const prev = lastTsByKey.get(key);
  const delta_ms = prev ? now - prev : 0;
  lastTsByKey.set(key, now);
  if (!sessionStartTs.has(key)) sessionStartTs.set(key, now);
  const elapsed_total_ms = now - (sessionStartTs.get(key) ?? now);

  const payload = {
    ts: now,
    delta_ms,
    elapsed_total_ms,
    ...(key !== 'pre-session' ? { session_key: key } : {}),
    ...(data ?? {}),
  };
  console.log('[upload:' + stage + '] ' + JSON.stringify(payload));

  // Mirror to analytics so post-failure debugging has a structured trail
  // beyond logcat (Sentry breadcrumbs once configured; in-house buffer
  // until then). Keep the property surface flat for filtering.
  track('upload_stage', { stage, delta_ms, elapsed_total_ms, ...(data ?? {}) });
}

/** Reset timing for a key — call when a new upload session begins so the
 *  cumulative `elapsed_total_ms` makes sense per upload. */
export function uploadResetTiming(key: string = 'pre-session'): void {
  lastTsByKey.delete(key);
  sessionStartTs.delete(key);
}

/** Promote a pre-session timing record to a session-keyed one once the
 *  sessionId is known (the ingest step). Preserves the elapsed-total
 *  baseline so the trace is continuous from pickVideo through UI render. */
export function uploadAdoptSessionKey(sessionId: string): void {
  const pre = sessionStartTs.get('pre-session');
  const last = lastTsByKey.get('pre-session');
  if (pre != null) sessionStartTs.set(sessionId, pre);
  if (last != null) lastTsByKey.set(sessionId, last);
  sessionStartTs.delete('pre-session');
  lastTsByKey.delete('pre-session');
}
