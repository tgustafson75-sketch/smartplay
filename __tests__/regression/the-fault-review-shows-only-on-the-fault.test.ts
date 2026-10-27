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
 *
 * 2026-10-27 (Tim: "Tapping Issue did not highlight the area") — the Issue chip is no longer the pause's
 * on/off: as a toggle that starts ON, its first tap turned the review off and showed nothing. The chip now
 * always jumps, holds and rings (the-issue-chip-shows-the-issue); turning the stop off is the "Pause on
 * issue" toggle's. The checks below that pinned the chip as the toggle are inverted, saying so.
 */
import fs from 'fs';
import path from 'path';
import { faultPauseTick, heldOnFault, issueChipPress } from '../../services/swing/faultSpotlight';

const F = 6.04;   // Lily's impact (early extension is an impact fault)

describe('the ring and the card show only on the fault', () => {
  it('held on the fault after the replay stopped there', () => {
    expect(heldOnFault({ faultSec: F, posSec: F, paused: true, atIssue: true, pausing: true })).toBe(true);
  });
  it('scrubbing to Address / Top / Finish takes them away, even with the stop flag still set', () => {
    for (const pos of [4.85, 5.65, 6.55]) {
      expect(heldOnFault({ faultSec: F, posSec: pos, paused: true, atIssue: true, pausing: true })).toBe(false);
    }
  });
  it('playing through the fault never shows them', () => {
    expect(heldOnFault({ faultSec: F, posSec: F + 0.01, paused: false, atIssue: false, pausing: true })).toBe(false);
  });
  it('paused by hand on the fault frame shows them', () => {
    expect(heldOnFault({ faultSec: F, posSec: F + 0.03, paused: true, atIssue: false, pausing: true })).toBe(true);
  });
  // 2026-10-16 (review) — a player who turned the pause off and JUMPS to the fault still sees what is wrong.
  it('pause off: a manual jump to the fault (atIssue) shows it', () => {
    expect(heldOnFault({ faultSec: F, posSec: F, paused: true, atIssue: true, pausing: false })).toBe(true);
  });
  // 2026-10-16 (re-review) — merely paused on the fault frame shows nothing once the pause is off (the
  // "Pause on issue" toggle since 10-27; it was the chip).
  it('paused on the fault frame, pause off, not held there: the ring and card go', () => {
    expect(heldOnFault({ faultSec: F, posSec: F, paused: true, atIssue: false, pausing: false })).toBe(false);
  });
});

describe('the fault stop turns on and off — the Issue chip always shows the fault', () => {
  // INVERTED 2026-10-27: 'on → off: no jump' was the defect (Tim's first tap turned the review off).
  it('the chip jumps whether the review pauses or not, and leaves the pause as it is', () => {
    expect(issueChipPress(true)).toEqual({ enabled: true, jumpToFault: true });
    expect(issueChipPress(false)).toEqual({ enabled: false, jumpToFault: true });
  });

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

/**
 * 2026-10-16 (adversarial review of S1b) — the chip flipped the PERSISTED swingReviewPauseOnIssue, so one
 * tap switched the founder's default review (stop on the fault) off for every future swing on both
 * screens. The chip now flips a per-review pause seeded from the setting on every swing opened.
 */
describe('the Issue chip never changes the pause — this review\'s or the saved default', () => {
  const root = path.join(__dirname, '..', '..');
  const lib = fs.readFileSync(path.join(root, 'app/swinglab/swing/[swing_id].tsx'), 'utf8');
  const sm = fs.readFileSync(path.join(root, 'app/swinglab/smartmotion.tsx'), 'utf8');
  const handler = (src: string, name: string) => src.slice(src.indexOf(name), src.indexOf(name) + 500);
  for (const [label, src, name, seed] of [
    ['library', lib, 'const onIssueChip', /const reviewShotKey = `\$\{swing_id\}:\$\{shot\?\.id \?\? ''\}`;\s*useEffect\(\(\) => \{ setReviewPause\(pauseOnIssue\); \}, \[pauseOnIssue, reviewShotKey\]\);/],
    ['SmartMotion', sm, 'const onReviewIssueChip', /const reviewShotKey = `\$\{cageSession\?\.id \?\? ''\}:\$\{cageSession\?\.shots\[selectedSwing\]\?\.id \?\? selectedSwing\}`;\s*useEffect\(\(\) => \{ setReviewPause\(pauseOnIssue\); \}, \[pauseOnIssue, reviewShotKey\]\);/],
  ] as const) {
    // INVERTED 2026-10-27: the chip used to flip the review's pause (setReviewPause(next.enabled)).
    it(`${label}: the chip jumps to the fault and touches neither pause`, () => {
      const h = handler(src, name).split('\n  };')[0].split('\n  }, [')[0];
      expect(h).toMatch(/issueChipPress\(reviewPause\)\.jumpToFault/);
      expect(h).toMatch(/jumpTo(Review)?Issue\(\)/);
      expect(h).not.toMatch(/setReviewPause/);
      expect(h).not.toMatch(/setPauseOnIssue/);
    });
    it(`${label}: every swing opens with the saved default, and the stop reads the review's pause`, () => {
      expect(src).toMatch(seed);
      expect(src).toMatch(/pauseOnIssueRef\.current = reviewPause;/);
    });
  }
});

describe('both review screens use the one rule', () => {
  const root = path.join(__dirname, '..', '..');
  const lib = fs.readFileSync(path.join(root, 'app/swinglab/swing/[swing_id].tsx'), 'utf8');
  const sm = fs.readFileSync(path.join(root, 'app/swinglab/smartmotion.tsx'), 'utf8');
  it('the library: held-on-fault gate, the Issue chip', () => {
    // 2026-10-27 — faultSec is the moment, else the Fault-moment pill's time held as the fault (issueJumpSec).
    expect(lib).toMatch(/const faultSec = faultMoment\?\.sec \?\? askedFaultSec;/);
    expect(lib).toMatch(/const onIssueFrame = heldOnFault\(\{ faultSec, posSec: position, paused: !isPlaying, atIssue, pausing: reviewPause \}\);/);
    expect(lib).toMatch(/onPress=\{onIssueChip\}/);
    expect(lib).not.toMatch(/onPress=\{jumpToIssue\}/);   // (the press event would arrive as the pill's seconds)
    expect(lib).not.toMatch(/!reviewPause && \{ textDecorationLine: 'line-through' \}/);   // the chip is not struck through
    expect(lib).toMatch(/faultPauseTick\(\{/);
    // the sticky gate is gone
    expect(lib).not.toMatch(/\(atIssue \|\| \(!isPlaying && Math\.abs\(position - faultMoment\.sec\) < 0\.08\)\)/);
  });
  it('SmartMotion: the same', () => {
    expect(sm).toMatch(/const reviewOnIssueFrame = isReview && heldOnFault\(\{/);
    expect(sm).toMatch(/atIssue: reviewAtIssue, pausing: reviewPause,/);
    expect(sm).toMatch(/onPress=\{onReviewIssueChip\}/);
    expect(sm).not.toMatch(/onPress=\{\(\) => void jumpToReviewIssue\(\)\}/);
    expect(sm).not.toMatch(/!reviewPause && \{ textDecorationLine: 'line-through' \}/);
    expect(sm).toMatch(/faultPauseTick\(\{/);
    expect(sm).not.toMatch(/reviewAtIssue \|\| \(videoPaused && Math\.abs/);
  });
});
