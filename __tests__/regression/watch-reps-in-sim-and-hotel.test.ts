/**
 * 2026-08-17 (Tim — "when you sim around or do your hotel drills, the watch should be able to pick
 * up motion for that. So if you're doing, like, you're simming the course and you swing, you've got
 * the phone and the watch swinging. I don't know if that would be duplicitous").
 *
 * The watch is now a rep source for SwingSim and Hotel Mode. Everything was already there — the
 * watch detects swings end-to-end into watchStore, and both screens read only the phone gyro and
 * had no idea it existed — so this is the join, and this pins the two things the join must get
 * right: what a wrist rep may honestly claim, and what happens when both IMUs see one swing.
 */
import {
  watchSwingToRep,
  watchTransitionGrade,
  RepDedupe,
  REP_DEDUPE_MS,
  type WatchSwingLike,
} from '../../services/swing/watchRep';

const swing = (over: Partial<WatchSwingLike> = {}): WatchSwingLike => ({
  backswingMs: 750,
  downswingMs: 250,
  tempoRatio: 3,
  transitionDetected: true,
  earlyTransition: false,
  tempoGood: true,
  timestamp: 1_000,
  ...over,
});

describe('a watch swing becomes a drill rep', () => {
  it('carries the times the IMU actually measured', () => {
    const rep = watchSwingToRep(swing(), 'swing');
    expect(rep).not.toBeNull();
    expect(rep!.backswingMs).toBe(750);
    expect(rep!.downswingMs).toBe(250);
    expect(rep!.tempoRatio).toBe(3);
    expect(rep!.source).toBe('watch');
  });

  it('derives tempo from the times when the watch did not send a ratio', () => {
    const rep = watchSwingToRep(swing({ tempoRatio: 0 }), 'swing');
    expect(rep!.tempoRatio).toBeCloseTo(3, 5);
  });

  it('grades the transition from what the watch does report', () => {
    // The phone grades from dwell through the top; the watch sends booleans instead.
    expect(watchTransitionGrade(swing({ earlyTransition: true }))).toBe('snatched');
    expect(watchTransitionGrade(swing({ earlyTransition: false, tempoGood: true }))).toBe('smooth');
    expect(watchTransitionGrade(swing({ earlyTransition: false, tempoGood: false }))).toBe('quick');
    // earlyTransition wins even when the watch also called the tempo good — a swing started from
    // the top is snatched regardless of how the ratio came out.
    expect(watchTransitionGrade(swing({ earlyTransition: true, tempoGood: true }))).toBe('snatched');
  });

  it('never invents the dwell it did not measure', () => {
    // 0, not a plausible-looking number. Nothing renders dwell — it exists only to produce the
    // grade, which is derived above — so an invented value would be pure fabrication.
    expect(watchSwingToRep(swing(), 'swing')!.transitionDwellMs).toBe(0);
  });

  it('never claims a putting through-stroke read the wrist cannot see', () => {
    // simGame applies no decel penalty for undefined, and the Hotel Mode chip does not render.
    expect(watchSwingToRep(swing(), 'putt')!.throughStroke).toBeUndefined();
    expect(watchSwingToRep(swing(), 'swing')!.throughStroke).toBeUndefined();
  });

  it('discards an unreadable swing instead of surfacing a bad rep', () => {
    expect(watchSwingToRep(swing({ backswingMs: 0 }), 'swing')).toBeNull();
    expect(watchSwingToRep(swing({ downswingMs: 0 }), 'swing')).toBeNull();
    expect(watchSwingToRep(null, 'swing')).toBeNull();
    expect(watchSwingToRep(undefined, 'swing')).toBeNull();
  });
});

describe('one swing, two IMUs, ONE rep', () => {
  it('drops the other sensor echoing the swing just taken', () => {
    // Tim's exact worry: phone in your hands, watch on your wrist, one swing.
    const d = new RepDedupe();
    expect(d.take('phone', 10_000)).toBe(true);
    expect(d.take('watch', 10_300)).toBe(false);
  });

  it('works in either order — whichever IMU reads it first wins', () => {
    const d = new RepDedupe();
    expect(d.take('watch', 10_000)).toBe(true);
    expect(d.take('phone', 10_400)).toBe(false);
  });

  it('never suppresses two real swings from the same sensor', () => {
    // Rapid-fire hotel reps on one IMU are two swings, not an echo.
    const d = new RepDedupe();
    expect(d.take('phone', 10_000)).toBe(true);
    expect(d.take('phone', 10_200)).toBe(true);
  });

  it('lets the other sensor through once the window has passed', () => {
    const d = new RepDedupe();
    expect(d.take('phone', 10_000)).toBe(true);
    expect(d.take('watch', 10_000 + REP_DEDUPE_MS + 1)).toBe(true);
  });

  it('accepts the very first rep from either source', () => {
    expect(new RepDedupe().take('watch', 0)).toBe(true);
    expect(new RepDedupe().take('phone', 0)).toBe(true);
  });

  it('a dropped echo does not move the window (it was never a swing of its own)', () => {
    const d = new RepDedupe();
    d.take('phone', 10_000);
    d.take('watch', 10_200);              // echo, dropped
    // The next PHONE swing is a real one and must still be accepted.
    expect(d.take('phone', 10_400)).toBe(true);
  });

  it('resets cleanly for a fresh session', () => {
    const d = new RepDedupe();
    d.take('phone', 10_000);
    d.reset();
    expect(d.take('watch', 10_100)).toBe(true);
  });
});
