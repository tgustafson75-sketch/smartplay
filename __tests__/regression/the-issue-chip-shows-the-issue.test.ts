/**
 * 2026-10-27 (Tim: "Tapping Issue did not highlight the area.")
 *
 * Four things stood between the tap and a ring around the fault, on both review screens:
 *   1. The Issue chip was a TOGGLE for "stop on the fault this review", and it starts ON — so the first
 *      tap turned the review off (struck through) and never jumped or highlighted. Only a second tap did.
 *   2. The ring obeyed the persisted Highlight setting even on an explicit jump, and the Highlight toggle
 *      that could turn it back on was hidden whenever the swing had no body read.
 *   3. The ring needs the body read, and the library never asked for swing 1's unless Body / Swing Trace
 *      was on — so on an old upload with no body read there was never anything to ring, and nothing said so.
 *   4. The Fault-moment pill, with no computed moment, did a bare seek: no hold, no ring, no caption.
 * And (audit R7) the library's swing 1 showed the SESSION headline, not its own read, so its own stored
 * fault frame was thrown away and the moment depended wholly on a body read.
 *
 * The rules live in services/swing/faultSpotlight; [swing_id].tsx and smartmotion.tsx both call them.
 */
import {
  FAULT_REGION_JOINTS,
  bodyReadNote,
  faultMomentFor,
  heldOnFault,
  issueChipPress,
  issueJumpSec,
  shotDetailRequestFor,
  spotlightShows,
  swingFaultOnScreen,
} from '../../services/swing/faultSpotlight';

const F = 6.04;
const joints = FAULT_REGION_JOINTS.early_extension.length;

describe('the Issue chip shows the issue, every tap', () => {
  it('first tap with the review pausing (the default) jumps there', () => {
    expect(issueChipPress(true)).toEqual({ enabled: true, jumpToFault: true });
  });
  it('the chip never turns the pause off — that is the Pause on issue toggle', () => {
    expect(issueChipPress(false)).toEqual({ enabled: false, jumpToFault: true });
  });
});

describe('an explicit jump rings the fault whatever the saved Highlight setting', () => {
  const base = { held: true, hasPose: true, faultJoints: joints };
  it('jump + Highlight off: ring', () => expect(spotlightShows({ ...base, hold: 'jump', highlight: false })).toBe(true));
  it('replay stop + Highlight off: no ring (the setting governs the passive stop)', () =>
    expect(spotlightShows({ ...base, hold: 'stop', highlight: false })).toBe(false));
  it('replay stop + Highlight on: ring', () => expect(spotlightShows({ ...base, hold: 'stop', highlight: true })).toBe(true));
  it('not held on the fault: never', () => expect(spotlightShows({ ...base, held: false, hold: 'jump', highlight: true })).toBe(false));
  it('no body read: no ring (a ring on a guessed spot is worse than none)', () =>
    expect(spotlightShows({ ...base, hasPose: false, hold: 'jump', highlight: true })).toBe(false));
});

describe('asking to see the issue asks for the body read', () => {
  it('swing 1, everything off, Issue tapped: the body read is requested', () => {
    expect(shotDetailRequestFor({ idx: 0, showSkeleton: false, traceAsked: false, issueAsked: true })).not.toBeNull();
  });
  it('...and only the body read — no tracker or paid arc for an Issue tap (explicitly false: undefined means the paid arc)', () => {
    expect(shotDetailRequestFor({ idx: 0, showSkeleton: false, traceAsked: false, issueAsked: true })).toEqual({ arc: false });
  });
  it('opening a settled swing with nothing asked still does no analysis work', () => {
    expect(shotDetailRequestFor({ idx: 0, showSkeleton: false, traceAsked: false, issueAsked: false })).toBeNull();
  });
  it('the existing asks are unchanged', () => {
    expect(shotDetailRequestFor({ idx: 2, showSkeleton: false, traceAsked: false, issueAsked: false })).toEqual({ arc: 'tracker' });
    expect(shotDetailRequestFor({ idx: 0, showSkeleton: true, traceAsked: false, issueAsked: true })).toEqual({ arc: 'tracker' });
    expect(shotDetailRequestFor({ idx: 0, showSkeleton: false, traceAsked: true, issueAsked: false })).toEqual({ arc: true });
  });
});

describe('never silent when there is nothing to ring', () => {
  it('asked, read on the way: "Reading your body position…"', () =>
    expect(bodyReadNote({ wanted: true, hasPose: false, pending: true })).toBe('reading'));
  it('asked, nothing came back: "No body read — Re-analyze"', () =>
    expect(bodyReadNote({ wanted: true, hasPose: false, pending: false })).toBe('no_read'));
  it('a body read is there: no note', () => expect(bodyReadNote({ wanted: true, hasPose: true, pending: false })).toBeNull());
  it('not asked: no note', () => expect(bodyReadNote({ wanted: false, hasPose: false, pending: false })).toBeNull());
});

describe('the Fault-moment pill holds on the fault even with no computed moment', () => {
  it('no moment (no anchors, other fault): the pill\'s own time is held as the fault', () => {
    const sec = issueJumpSec(null, F);
    expect(sec).toBe(F);
    expect(heldOnFault({ faultSec: sec, posSec: F, paused: true, atIssue: true, pausing: true })).toBe(true);
  });
  it('a computed moment wins over the pill time', () => expect(issueJumpSec(5.5, F)).toBe(5.5));
});

describe('audit R7 — the library\'s swing 1 shows its OWN read', () => {
  const headline = { issue_id: 'over_the_top', primary_fault: 'over_the_top', severity: 'moderate' };
  const own = { detected_issue: 'none', primary_fault: 'early_extension', severity: 'significant' };
  it('swing 1 with its own read: that read\'s fault and severity', () => {
    expect(swingFaultOnScreen(0, headline, own)).toEqual({ faultId: 'early_extension', severe: true });
  });
  it('...so its own stored fault frame times the stop (it was thrown away as "another fault")', () => {
    const { faultId } = swingFaultOnScreen(0, headline, own);
    const m = faultMomentFor({ faultId, readTimestampsSec: faultId === own.primary_fault ? [F] : [], anchors: null, windowStartSec: 4, windowEndSec: 8 });
    expect(m).toEqual({ sec: F, source: 'read' });
  });
  it('legacy swing 1 with no per-swing read: the session headline', () => {
    expect(swingFaultOnScreen(0, headline, undefined)).toEqual({ faultId: 'over_the_top', severe: false });
  });
  it('swings 2+ unchanged: their own read, none → no fault', () => {
    expect(swingFaultOnScreen(1, headline, { detected_issue: 'none', primary_fault: null })).toEqual({ faultId: null, severe: false });
  });
});
