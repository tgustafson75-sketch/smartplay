/**
 * 2026-06-04 — Voice diagnostics bridge.
 *
 * Surfaces speak/transcribe/kevin failures into the existing /owner-logs
 * surface so Tim (and beta testers) can see what failed without an ADB
 * cable. Three call sites:
 *
 *   - logVoiceError:       sendToBrain catch / processAudioUri catch
 *                          ("Hit a snag on my end. Try again.")
 *   - logTranscribeError:  /api/transcribe non-2xx OR error field present
 *   - logVoiceSilentFail:  every silent-return path in voiceService.speak()
 *                          (preempted-after-fetch, small-payload, dead-load,
 *                          etc.) — the cases that historically left no UI
 *                          trace at all.
 *
 * The helpers are intentionally fire-and-forget. They MUST NOT throw,
 * because they sit inside catch blocks and silent-return paths that
 * already represent a failure state. They also MUST NOT block — store
 * writes are sync but the context snapshot dynamic-requires the round /
 * settings stores to avoid the voiceService → store → voiceService
 * module cycle.
 */

import type { IssueLogEntry, IssueLogKind } from '../store/issueLogStore';

function snapshotContext(): IssueLogEntry['context'] {
  try {
    // Dynamic requires — voiceService.ts is imported very early in the
    // boot sequence; static imports here would risk a cycle. The cost
    // is one require() per log call (~microseconds; this is a failure
    // path anyway).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const round = require('../store/roundStore').useRoundStore.getState();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const settings = require('../store/settingsStore').useSettingsStore.getState();
    let route: string | null = null;
    try { route = require('./routeBreadcrumb').getRoute() ?? null; } catch { /* tracker absent */ }
    return {
      route,
      persona: settings.caddiePersonality ?? null,
      isRoundActive: !!round.isRoundActive,
      courseId: round.activeCourseId ?? null,
      currentHole: round.isRoundActive ? round.currentHole : null,
      appVersion: '1.0.0',
    };
  } catch {
    return {
      route: null,
      persona: null,
      isRoundActive: false,
      courseId: null,
      currentHole: null,
      appVersion: '1.0.0',
    };
  }
}

/**
 * 2026-08-19 (Tim — "make sure we have some special logic in the issue catching and issue log. They
 * can catch the first turn logic").
 *
 * THE FIRST TURN IS A DIFFERENT FAILURE FROM THE FIFTH, and the log could not tell them apart.
 * Every cold-start defect this app has had — the 22s cold budget, the dual-host failover, today's
 * pipecat path that ran blind to cold start and then went silent — is a FIRST-TURN failure. They read
 * in the log exactly like a mid-conversation blip, so the one number that would have identified the
 * class instantly was the one number missing.
 *
 * Stamped HERE, at the single choke point every voice log passes through, rather than at ~20 call
 * sites. A call site that forgets is a call site that hides the class again, and this file already
 * owns "what context does a voice failure carry".
 *
 * `first_turn` is the actionable one: true means the connection was never proven warm when this
 * failed, so it is a cold-start problem and not a network blip. `turn` gives the position in the
 * session, so "always the 1st" versus "the 1st and the 9th" are distinguishable at a glance.
 */
let voiceTurnCounter = 0;
/** Called by the voice paths when a turn STARTS, so the log can say which turn failed. */
export function noteVoiceTurnStarted(): number {
  voiceTurnCounter += 1;
  return voiceTurnCounter;
}
/** Reset per session/round start — a fresh conversation starts counting again. */
export function resetVoiceTurnCounter(): void { voiceTurnCounter = 0; }

function turnContext(): Record<string, unknown> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { isConnectionWarmed } = require('./apiBase') as typeof import('./apiBase');
    const warmed = isConnectionWarmed();
    return {
      // The whole point: was the connection ever proven warm when this failed?
      first_turn: !warmed,
      warmed,
      turn: voiceTurnCounter || null,
    };
  } catch {
    return { first_turn: null, warmed: null, turn: voiceTurnCounter || null };
  }
}

function write(
  kind: Exclude<IssueLogKind, 'user'>,
  stage: string,
  details?: Record<string, unknown>,
): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useIssueLogStore } = require('../store/issueLogStore') as typeof import('../store/issueLogStore');
    // Turn context first so an explicit detail from the call site always wins.
    useIssueLogStore.getState().addVoiceEvent(kind, stage, snapshotContext(), { ...turnContext(), ...details });
  } catch (e) {
    // Logging the log failure to console only — by design we never
    // recurse or throw from this path.
    console.log('[voiceErrorLog] write failed (non-fatal):', e);
  }
}

export function logVoiceError(
  stage: string,
  error: unknown,
  extra?: Record<string, unknown>,
): void {
  const message = error instanceof Error ? error.message : String(error ?? '');
  write('voice_error', stage, { error: message, ...extra });
}

export function logVoiceSilentFail(
  stage: string,
  extra?: Record<string, unknown>,
): void {
  write('voice_silent_fail', stage, extra);
}

export function logTranscribeError(
  status: number | null,
  errorBody: unknown,
  extra?: Record<string, unknown>,
): void {
  const error =
    typeof errorBody === 'string'
      ? errorBody.slice(0, 300)
      : errorBody == null
        ? null
        : String(errorBody).slice(0, 300);
  write('transcribe_error', 'transcribe_http', { status, error, ...extra });
}
