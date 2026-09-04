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

/**
 * 2026-08-24 (Tim's device log) — "voice_error: capture_utterance — All promises were rejected".
 *
 * That is not a failure description, it is the shape of a Promise.any. The voice path races a
 * primary request against a hedged one; when BOTH reject, Promise.any throws an AggregateError whose
 * message is the literal string "All promises were rejected", and the actual causes sit unread in
 * err.errors[]. So every hedged failure in the field reported the racing strategy instead of the
 * reason — AbortError, Network request failed, a busy microphone — and three separate log entries
 * told us nothing we could act on.
 *
 * Unwrap it: report what the attempts actually threw.
 */
export function describeError(error: unknown): string {
  if (error instanceof AggregateError || (error != null && typeof error === 'object' && Array.isArray((error as { errors?: unknown }).errors))) {
    const inner = ((error as { errors?: unknown[] }).errors ?? [])
      .map((e) => (e instanceof Error ? (e.name === 'Error' ? e.message : `${e.name}: ${e.message}`) : String(e ?? '')))
      .filter(Boolean);
    const unique = [...new Set(inner)];
    if (unique.length) return `all attempts failed — ${unique.join(' | ')}`.slice(0, 300);
  }
  return (error instanceof Error ? error.message : String(error ?? '')).slice(0, 300);
}

export function logVoiceError(
  stage: string,
  error: unknown,
  extra?: Record<string, unknown>,
): void {
  write('voice_error', stage, { error: describeError(error), ...extra });
}

/**
 * 2026-09-04 (Tim — "strip all the nonissue reporting issues to the issue log") — STAGES THAT ARE
 * NOT FAILURES.
 *
 * `voice_silent_fail` is in REPORTABLE_KINDS, so every stage logged through it is auto-forwarded to
 * the owner inbox as a problem. Several of these stages record the OPPOSITE of a problem:
 *
 *   local_responder_hit    the local responder ANSWERED — the fast path working
 *   ondevice_stt_hit       on-device speech recognition succeeded, no network needed
 *   local_responder_miss   nothing local matched, so it fell through to the brain. By design.
 *   persona_handoff_intro  a persona change spoke its intro line. Not an error in any sense.
 *
 * They were logged through this helper because it was the convenient way to get a structured voice
 * event with turn context attached, not because anyone judged them failures. The result is an inbox
 * where successes outnumber defects and the real ones stop being read — the exact failure the 'diag'
 * kind was introduced for on 2026-08-19, when the pose locator's SUCCESS breadcrumbs were being
 * mailed as analysis errors.
 *
 * Downgraded, not deleted. Every one of these still lands in the store and still shows in
 * /owner-logs, because on-device they are genuinely useful — knowing the local responder handled a
 * turn is how we tell a fast answer from a missing one. They simply stop being mailed as problems.
 * [[guards-by-element-not-blanket-suppression]]
 *
 * Deliberately NOT included: the speak_preempted_* family. A preempt is usually by design, but it
 * was also the symptom that exposed a speculative brain call fired and discarded on every turn for
 * eight weeks. Those stay reportable until someone has a reason beyond noise to silence them.
 */
const NON_FAILURE_STAGES: ReadonlySet<string> = new Set([
  'local_responder_hit',
  'local_responder_miss',
  'ondevice_stt_hit',
  'persona_handoff_intro',
]);

/** True when a stage records normal behaviour rather than a failure. Exported for the guard. */
export function isNonFailureStage(stage: string): boolean {
  return NON_FAILURE_STAGES.has(stage);
}

export function logVoiceSilentFail(
  stage: string,
  extra?: Record<string, unknown>,
): void {
  write(isNonFailureStage(stage) ? 'diag' : 'voice_silent_fail', stage, extra);
}

/**
 * A voice event worth KEEPING on the device and worth nothing in an inbox. Same store, same
 * /owner-logs visibility, but 'diag' is not in REPORTABLE_KINDS so it is never auto-forwarded.
 * Use it for the happy path, and for the downstream effect of a failure already reported upstream.
 */
export function logVoiceDiag(
  stage: string,
  extra?: Record<string, unknown>,
): void {
  write('diag', stage, extra);
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
