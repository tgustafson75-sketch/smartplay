/**
 * SMARTMOTION CAPTURE LIFE — who still wants a start, a scan or a follow-up, after an await.
 *
 * 2026-10-27 (capture-half audit C1, C3, C4, C6). The screen's capture code is a chain of awaits
 * (mic permission, stopping speech, opening the metered track, flushing the clip, a club photo, a
 * recognition call) and every one of them could land after the thing it was for had gone:
 *
 *   C1  the player left during "Analyzing…" — the stop handler carried on and, on the NEXT screen,
 *       narrated the set, set the "just finished a session" context (the caddie spoke and opened
 *       the mic), spoke a putt read, and the Smart Tempo return yanked them back.
 *   C3  Stop tapped while Record was still opening the meter — the stop found no recording, then
 *       the start finished: the camera recorded hidden, Record was dead for the whole window, and a
 *       surprise analysis ran when the timer fired.
 *   C4  Record tapped during a club scan — the scan still took its photo into the recording and
 *       spoke "Got it, 7-iron" into the clip's audio.
 *   C6  a capture that failed went back to setup with a message nobody could see, and a go-again
 *       queued during the read stayed armed, so the NEXT review auto-saved and re-recorded.
 *
 * One owner for the answer to "is this still wanted?", pure so jest can drive the races the screen
 * itself cannot be mounted to show. The screen keeps the effects; this owns the rule.
 */

export interface CaptureLife {
  /** The screen mounted (again). */
  mount(): void;
  /** The screen is gone: nothing may speak, open the mic, navigate or start for it any more. */
  end(): void;
  isAlive(): boolean;

  /** A start begins: supersedes any earlier start still in flight, cancels a scan, drops a queued go-again. */
  beginStart(): number;
  /** After every await in a start: false when a stop, a newer start or leaving superseded it. */
  startStillWanted(token: number): boolean;
  /** The camera is recording for this start — it is a recording now, not a start. */
  commitStart(token: number): void;
  /** True between beginStart and commitStart (or a cancel). */
  isStarting(): boolean;
  /** Stop arrived while the start was still opening: the start must abandon itself. */
  cancelStart(): void;

  /** A club scan begins; null when the screen is gone or a capture is starting/recording. */
  beginScan(recording: boolean): number | null;
  /** Before the photo and before applying/speaking the result. */
  scanStillWanted(token: number, recording: boolean): boolean;

  queueGoAgain(): void;
  hasQueuedGoAgain(): boolean;
  /** Read-and-clear: the queued go-again fires once. */
  takeQueuedGoAgain(): boolean;

  /** A capture failed before there was anything to review: the message to SHOW, and the queue is dropped. */
  captureFailed(kind: CaptureFailure): string;

  /** What the stop handler may still do for the player once the swing is saved and its read started. */
  followUps(input: { swingCount: number; putt: boolean }): CaptureFollowUps;
}

export type CaptureFailure = 'no_file' | 'camera_refused';

export interface CaptureFollowUps {
  /** Speak the per-swing pipeline narration for a multi-swing set. */
  narrateSet: boolean;
  /** Set the "just finished a session" context + emit session_complete (the caddie speaks and listens). */
  announceDone: boolean;
}

export const CAPTURE_FAILURE_MESSAGE: Record<CaptureFailure, string> = {
  no_file: "That recording didn't save — tap Record to go again.",
  camera_refused: "The camera couldn't start recording — tap Record to try again.",
};

export function createCaptureLife(): CaptureLife {
  let alive = true;
  let startEpoch = 0;
  let starting = false;
  let scanEpoch = 0;
  let queuedGoAgain = false;

  return {
    mount() { alive = true; },
    end() {
      alive = false;
      startEpoch += 1;
      starting = false;
      scanEpoch += 1;
      queuedGoAgain = false;
    },
    isAlive: () => alive,

    beginStart() {
      startEpoch += 1;
      starting = true;
      scanEpoch += 1; // the player chose to record: a scan in flight is no longer wanted
      queuedGoAgain = false;
      return startEpoch;
    },
    startStillWanted: (token) => alive && token === startEpoch,
    commitStart(token) { if (token === startEpoch) starting = false; },
    isStarting: () => starting,
    cancelStart() { startEpoch += 1; starting = false; },

    beginScan(recording) {
      if (!alive || recording || starting) return null;
      scanEpoch += 1;
      return scanEpoch;
    },
    scanStillWanted: (token, recording) => alive && !recording && !starting && token === scanEpoch,

    queueGoAgain() { if (alive) queuedGoAgain = true; },
    hasQueuedGoAgain: () => queuedGoAgain,
    takeQueuedGoAgain() { const q = queuedGoAgain; queuedGoAgain = false; return q; },

    captureFailed(kind) {
      queuedGoAgain = false;
      return CAPTURE_FAILURE_MESSAGE[kind];
    },

    followUps({ swingCount, putt }) {
      if (!alive || putt) return { narrateSet: false, announceDone: false };
      return { narrateSet: swingCount > 1, announceDone: swingCount === 1 };
    },
  };
}

/**
 * Wait (bounded) until a holder lets go — the camera's metered track cannot open while another
 * Recording is still being unloaded ("Only one Recording object can be prepared at a given time").
 * Resolves true when free, false when the deadline passed with it still held.
 */
export async function waitUntilFree(isBusy: () => boolean, timeoutMs = 1500, stepMs = 50): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (isBusy()) {
    if (Date.now() >= deadline) return false;
    await new Promise<void>((r) => setTimeout(r, stepMs));
  }
  return true;
}
