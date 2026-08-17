/**
 * 2026-08-17 (Tim — "when you sim around or do your hotel drills, the watch should be able to pick
 * up motion for that. So if you're doing, like, you're simming the course and you swing, you've got
 * the phone and the watch swinging. I don't know if that would be duplicitous").
 *
 * The watch IMU as a rep source for SwingSim + Hotel Mode, and the answer to "duplicitous".
 *
 * Everything needed already existed and was never joined up: the watch detects swings end-to-end
 * (SwingSensorService.kt → WearSwingBridgeModule.kt → watchSwingBridge → watchStore.recordSwing)
 * and emits exactly the quantities these drills consume, while the two screens read the PHONE gyro
 * and had no idea a watch existed. This is the join, plus the one thing joining them requires: a
 * rule for when both IMUs saw the same physical swing.
 *
 * WHAT A WATCH REP CAN HONESTLY FILL:
 *   tempoRatio / backswingMs / downswingMs — YES. These are TIMES, measured directly by the IMU.
 *     A 3:1 tempo is 3:1 whether a phone in your hands or a watch on your wrist counted it. This is
 *     the same argument SmartMotion already makes when it takes wrist tempo and refuses wrist speed.
 *   transition — DERIVED, not measured. The phone grades it from dwell time through the top; the
 *     watch sends booleans instead (earlyTransition / tempoGood), so the grade is mapped from those
 *     and `transitionDwellMs` is reported as 0 rather than invented. Nothing renders dwell — it
 *     exists only to produce the grade the phone path already produces — so 0 shows nowhere.
 *   throughStroke (putting decel read) — NO. That needs the through-stroke acceleration profile the
 *     watch doesn't send. Left undefined, which every consumer already handles: simGame applies no
 *     decel penalty and the Hotel Mode chip simply doesn't render. A putt rep from the wrist is a
 *     tempo rep, and says nothing it cannot measure. [[illustration-data-points]]
 *
 * Pure + dependency-free so it unit-tests, matching services/indoorSwing itself.
 */

import type { IndoorRep, IndoorMode, TransitionGrade } from '../indoorSwing';

/** The subset of watchStore's SwingMetrics this needs — structural, so no store import. */
export interface WatchSwingLike {
  backswingMs: number;
  downswingMs: number;
  tempoRatio: number;
  transitionDetected: boolean;
  earlyTransition: boolean;
  tempoGood: boolean;
  timestamp: number;
}

/**
 * Two IMUs, one body. When you swing the phone while wearing the watch, BOTH detect it — that is
 * Tim's "duplicitous" worry, and it is real: without this the sim would play two shots for one
 * swing and Hotel Mode would log a rep twice, inflating every average built from them.
 *
 * A rep from a DIFFERENT source inside this window is the same physical swing, so it is dropped.
 * Wide enough to cover the two detectors' different endpoint criteria (the phone ends a rep on
 * speed decay, the watch on its own impact read, and they don't land together); far shorter than
 * any real swing-to-swing gap, since even rapid-fire hotel reps need a re-setup.
 */
export const REP_DEDUPE_MS = 1_500;

/** Map the watch's transition booleans onto the phone's dwell-derived grade. */
export function watchTransitionGrade(sw: WatchSwingLike): TransitionGrade {
  // earlyTransition is the watch's own name for starting down before the backswing has settled —
  // the same fault 'snatched' names on the phone side.
  if (sw.earlyTransition) return 'snatched';
  if (sw.tempoGood) return 'smooth';
  return 'quick';
}

/**
 * Convert a watch swing into an IndoorRep, or null when it isn't usable as one.
 *
 * Rejects on the same basis the phone detector discards an unreadable rep: without real backswing
 * and downswing times there is no tempo, and a fabricated one would flow into the CNS tempo picture
 * that Hotel Mode and SwingSim both feed. A waggle the watch reported with no transition and no
 * meaningful times is not a swing.
 */
export function watchSwingToRep(sw: WatchSwingLike | null | undefined, mode: IndoorMode): IndoorRep | null {
  if (!sw) return null;
  const backswingMs = Math.round(sw.backswingMs ?? 0);
  const downswingMs = Math.round(sw.downswingMs ?? 0);
  if (backswingMs <= 0 || downswingMs <= 0) return null;
  const ratio = sw.tempoRatio > 0 ? sw.tempoRatio : backswingMs / Math.max(1, downswingMs);
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  // Carried for symmetry with the phone detector, which branches on it. A watch rep deliberately
  // omits throughStroke in BOTH modes: the wrist cannot see the through-stroke acceleration
  // profile, so a watch putt rep is a tempo rep and claims nothing more.
  void mode;
  return {
    tempoRatio: ratio,
    backswingMs,
    downswingMs,
    transition: watchTransitionGrade(sw),
    // Not measured by the watch. 0 rather than an invented number; nothing renders it.
    transitionDwellMs: 0,
    source: 'watch',
  };
}

/**
 * Per-screen dedupe across the two IMUs. Instantiated by the screen (not a module global) so two
 * mounted surfaces can never share or leak each other's state.
 *
 * Same-source reps are ALWAYS allowed: two fast phone reps in a row are two real swings, and the
 * detectors already have their own endpoint logic. Only a cross-source rep inside the window is
 * treated as the echo of the one just taken.
 */
export class RepDedupe {
  private lastAt = 0;
  private lastSource: 'phone' | 'watch' | null = null;

  constructor(private readonly windowMs: number = REP_DEDUPE_MS) {}

  /** True when this rep is the OTHER IMU re-reporting the swing we just accepted. */
  isEcho(source: 'phone' | 'watch', nowMs: number): boolean {
    if (this.lastSource === null) return false;
    if (this.lastSource === source) return false;
    return nowMs - this.lastAt < this.windowMs;
  }

  /** Record an accepted rep. Call only for reps actually taken. */
  accept(source: 'phone' | 'watch', nowMs: number): void {
    this.lastAt = nowMs;
    this.lastSource = source;
  }

  /** isEcho + accept in one step. Returns true when the caller should USE this rep. */
  take(source: 'phone' | 'watch', nowMs: number): boolean {
    if (this.isEcho(source, nowMs)) return false;
    this.accept(source, nowMs);
    return true;
  }

  reset(): void {
    this.lastAt = 0;
    this.lastSource = null;
  }
}
