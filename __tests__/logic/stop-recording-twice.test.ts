/**
 * 2026-09-19, from production (iPhone 17 Pro, iOS 26.6.2, four events, one player,
 * route /swinglab/smartmotion):
 *
 *     capture/no-recording-in-progress: There was no active video recording in progress!
 *     Did you call stopRecording() twice?          mechanism: onunhandledrejection
 *
 * components/capture/SwingVisionCamera said "the caller also sets its own timeout; double-stop is
 * guarded" and nothing guarded it. Four things can stop a swing capture — the screen's timeout, the
 * camera's own backstop, the Stop button, the voice command — and the first two are set to the same
 * duration, so they land in the same tick.
 *
 * The rejection escaped because `try { cam.stopRecording() } catch {}` cannot catch a PROMISE.
 * vision-camera declares `stopRecording(): Promise<void>` and rejects through
 * `tryParseNativeCameraError`, which is the exact frame in the reported stack.
 *
 * Both halves are asserted here because either alone leaves the field report possible.
 */
import { createRecordingGate } from '../../services/capture/recordingGate';

describe('stopping a recording that is not running', () => {
  it('THE REPORT: a second stop never reaches the camera', () => {
    let calls = 0;
    const gate = createRecordingGate(() => { calls += 1; });
    gate.markStarted();

    expect(gate.stop()).toBe(true);    // the screen's timeout
    expect(gate.stop()).toBe(false);   // the camera's backstop, same tick
    expect(gate.stop()).toBe(false);   // the Stop button, for good measure
    expect(calls).toBe(1);
  });

  it('a stop before anything started is a no-op, not a call', () => {
    let calls = 0;
    const gate = createRecordingGate(() => { calls += 1; });
    expect(gate.stop()).toBe(false);
    expect(calls).toBe(0);
  });

  it('a recording that ended on its own cannot be stopped again', () => {
    let calls = 0;
    const gate = createRecordingGate(() => { calls += 1; });
    gate.markStarted();
    gate.markStopped();            // onRecordingFinished / onRecordingError
    expect(gate.stop()).toBe(false);
    expect(calls).toBe(0);
  });

  /**
   * THE HALF THAT SENT IT TO SENTRY. The flag cannot know that a recording ended natively between
   * our last update and this call, so the rejection must still land somewhere. An unhandled
   * rejection here is not cosmetic: it is reported as an error event against a player who did
   * nothing wrong, and it buries the events that matter.
   */
  it('a REJECTING native stop never becomes an unhandled rejection', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (e: PromiseRejectionEvent | unknown) => unhandled.push(e);
    process.on('unhandledRejection', onUnhandled);
    try {
      const gate = createRecordingGate(() =>
        Promise.reject(new Error('capture/no-recording-in-progress')));
      gate.markStarted();
      expect(gate.stop()).toBe(true);
      // Let the microtask queue drain — an uncaught rejection surfaces here.
      await new Promise((r) => setTimeout(r, 10));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('a SYNCHRONOUSLY throwing stop does not propagate either', () => {
    const gate = createRecordingGate(() => { throw new Error('no camera ref'); });
    gate.markStarted();
    expect(() => gate.stop()).not.toThrow();
    expect(gate.isRecording).toBe(false);
  });

  it('the flag is cleared BEFORE the call, so a stop arriving mid-flight finds it closed', () => {
    let reentrantResult: boolean | null = null;
    const gate = createRecordingGate(() => {
      // The Stop button pressed while the native stop is still in flight.
      reentrantResult = gate.stop();
      return Promise.resolve();
    });
    gate.markStarted();
    gate.stop();
    expect(reentrantResult).toBe(false);
  });
});
