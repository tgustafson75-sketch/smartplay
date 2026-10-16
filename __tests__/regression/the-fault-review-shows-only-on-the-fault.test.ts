/**
 * 2026-10-16 — two founder reports on the fault review (Lily's 4075 clip):
 *
 *   1. The orange ring and the "PAUSED ON THE ISSUE" card stayed on EVERY frame while he scrubbed to
 *      Address / Top / Finish. The gate was `atIssue || (paused && near the fault)`, and nothing but
 *      playing cleared `atIssue` — so after one stop the ring rode along to every stage chip.
 *   2. "You can't turn it off, so every time you continue the swing it always stops again at the
 *      fault." The Issue chip only jumped to the fault; the replay loop released the latch and stopped
 *      there again on every pass.
 *
 * One rule for both review screens now lives in services/swing/faultSpotlight (faultPauseTick,
 * heldOnFault, issueChipPress); the library screen and SmartMotion's review both call it.
 */
import fs from 'fs';
import path from 'path';
import { faultPauseTick, heldOnFault, issueChipPress } from '../../services/swing/faultSpotlight';

const F = 6.04;   // Lily's impact (early extension is an impact fault)

describe('the ring and the card show only on the fault', () => {
  it('held on the fault after the replay stopped there', () => {
    expect(heldOnFault({ faultSec: F, posSec: F, paused: true, atIssue: true, enabled: true })).toBe(true);
  });
  it('scrubbing to Address / Top / Finish takes them away, even with the stop flag still set', () => {
    for (const pos of [4.85, 5.65, 6.55]) {
      expect(heldOnFault({ faultSec: F, posSec: pos, paused: true, atIssue: true, enabled: true })).toBe(false);
    }
  });
  it('playing through the fault never shows them', () => {
    expect(heldOnFault({ faultSec: F, posSec: F + 0.01, paused: false, atIssue: false, enabled: true })).toBe(false);
  });
  it('paused by hand on the fault frame shows them', () => {
    expect(heldOnFault({ faultSec: F, posSec: F + 0.03, paused: true, atIssue: false, enabled: true })).toBe(true);
  });
  it('with the fault review switched off, nothing shows', () => {
    expect(heldOnFault({ faultSec: F, posSec: F, paused: true, atIssue: true, enabled: false })).toBe(false);
  });
});

describe('the Issue chip turns the fault review on and off', () => {
  it('on → off: no jump', () => expect(issueChipPress(true)).toEqual({ enabled: false, jumpToFault: false }));
  it('off → on: and show the fault now', () => expect(issueChipPress(false)).toEqual({ enabled: true, jumpToFault: true }));

  /** Play a pass from the window start through the end, 100ms ticks; return the stops. */
  const playPass = (state: { latched: boolean; last: number }, enabled: boolean, from = 4.3, to = 7.5) => {
    const stops: number[] = [];
    for (let p = from; p <= to; p = Math.round((p + 0.1) * 1000) / 1000) {
      const tick = faultPauseTick({ faultSec: F, posSec: p, lastPosSec: state.last, playing: true, enabled, latched: state.latched, selfSeeking: false });
      if (tick === 'unlatch') state.latched = false;
      if (tick === 'stop') { state.latched = true; stops.push(p); state.last = F; break; }
      state.last = p;
    }
    return stops;
  };

  it('Continue plays through the rest of that pass without stopping again', () => {
    const st = { latched: false, last: -1 };
    expect(playPass(st, true).length).toBe(1);
    // Continue: playback resumes from the fault frame to the end.
    expect(playPass(st, true, F, 7.5)).toEqual([]);
  });

  it('switched off, a replay never stops; switched back on, it does', () => {
    const st = { latched: false, last: -1 };
    expect(playPass(st, false)).toEqual([]);
    st.last = -1;
    expect(playPass(st, false)).toEqual([]);
    st.last = -1;
    expect(playPass(st, true).length).toBe(1);
  });
});

describe('both review screens use the one rule', () => {
  const root = path.join(__dirname, '..', '..');
  const lib = fs.readFileSync(path.join(root, 'app/swinglab/swing/[swing_id].tsx'), 'utf8');
  const sm = fs.readFileSync(path.join(root, 'app/swinglab/smartmotion.tsx'), 'utf8');
  it('the library: held-on-fault gate, Issue chip as the toggle', () => {
    expect(lib).toMatch(/const onIssueFrame = heldOnFault\(\{ faultSec: faultMoment\?\.sec \?\? null, posSec: position, paused: !isPlaying, atIssue, enabled: pauseOnIssue \}\);/);
    expect(lib).toMatch(/onPress=\{onIssueChip\}/);
    expect(lib).not.toMatch(/onPress=\{jumpToIssue\}/);
    expect(lib).toMatch(/faultPauseTick\(\{/);
    // the sticky gate is gone
    expect(lib).not.toMatch(/\(atIssue \|\| \(!isPlaying && Math\.abs\(position - faultMoment\.sec\) < 0\.08\)\)/);
  });
  it('SmartMotion: the same', () => {
    expect(sm).toMatch(/const reviewOnIssueFrame = isReview && heldOnFault\(\{/);
    expect(sm).toMatch(/onPress=\{onReviewIssueChip\}/);
    expect(sm).not.toMatch(/onPress=\{\(\) => void jumpToReviewIssue\(\)\}/);
    expect(sm).toMatch(/faultPauseTick\(\{/);
    expect(sm).not.toMatch(/reviewAtIssue \|\| \(videoPaused && Math\.abs/);
  });
});
