/**
 * "IS SOMETHING ACTUALLY RECORDING?" — the state a stop button has to consult, and the catch a
 * rejecting native stop has to land in.
 *
 * 2026-09-19, from production (iPhone 17 Pro, iOS 26.6.2, four events from one player on
 * /swinglab/smartmotion):
 *
 *     capture/no-recording-in-progress: There was no active video recording in progress!
 *     Did you call stopRecording() twice?          mechanism: onunhandledrejection
 *
 * TWO BUGS, AND THE SECOND IS WHY IT ESCAPED.
 *
 * 1. NOTHING TRACKED WHETHER A RECORDING WAS RUNNING. components/capture/SwingVisionCamera carried
 *    the comment "the caller also sets its own timeout; double-stop is guarded" and no guard
 *    existed. Four different things can stop a swing capture — the screen's own timeout, the
 *    camera's backstop timer, the Stop button, the voice command — and the first two are set to the
 *    SAME duration, while `onRecordingFinished` only clears the backstop after a native round trip.
 *    So they land in the same tick and the second one has nothing to stop.
 *
 * 2. `try { cam.stopRecording() } catch {}` CANNOT CATCH IT. vision-camera declares
 *    `stopRecording(): Promise<void>` and rejects through `tryParseNativeCameraError` — the exact
 *    frame in the reported stack. A synchronous catch around a promise-returning call sees nothing,
 *    so the rejection escaped as an unhandled one and went to Sentry four times.
 *
 * Pure and standalone so BOTH halves are testable without a native module: the component that had
 * the bug cannot be mounted in jest, which is a large part of why this went unnoticed. The state
 * still lives with the recording; this owns the rule about it.
 *
 * DELIBERATELY BELT AND BRACES. The flag stops the ordinary double-call; the catch covers the case
 * the flag cannot know about — a recording that ended natively between our last update and this
 * call. Either alone would have left the field report possible.
 * [[no-half-fixes-enforce-every-surface]]
 */

export interface RecordingGate {
  /** Call once a start has actually succeeded — never before, or a failed start invites a stop. */
  markStarted(): void;
  /** Call when the recording ends on its own (finished, errored, cancelled). */
  markStopped(): void;
  readonly isRecording: boolean;
  /**
   * Stop, if there is anything to stop. Returns whether the underlying stop was invoked, which is
   * what a test can assert and a caller can log.
   */
  stop(): boolean;
}

export function createRecordingGate(stopNative: () => unknown): RecordingGate {
  let recording = false;
  return {
    markStarted() { recording = true; },
    markStopped() { recording = false; },
    get isRecording() { return recording; },
    stop() {
      if (!recording) return false;
      // Cleared BEFORE the call, not after: the native stop is async, and a second press landing
      // while it is in flight is precisely the race this exists to close.
      recording = false;
      try {
        const p = stopNative() as Promise<unknown> | undefined;
        if (p && typeof (p as Promise<unknown>).catch === 'function') {
          (p as Promise<unknown>).catch(() => { /* already stopped natively — a non-event */ });
        }
      } catch { /* a synchronous throw (no camera ref) — the same non-event */ }
      return true;
    },
  };
}
