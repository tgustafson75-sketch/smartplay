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
    return {
      route: null,
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

function write(
  kind: Exclude<IssueLogKind, 'user'>,
  stage: string,
  details?: Record<string, unknown>,
): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useIssueLogStore } = require('../store/issueLogStore') as typeof import('../store/issueLogStore');
    useIssueLogStore.getState().addVoiceEvent(kind, stage, snapshotContext(), details);
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
