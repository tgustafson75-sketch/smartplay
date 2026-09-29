/**
 * 2026-09-29 — the swing-analysis sample: nine evenly spaced frames, sized by the long edge, from a
 * window the device located even on a short clip. Pure halves of services/swing/analysisFrames; the
 * end-to-end path through analyzeSwing is __tests__/regression/the-swing-read-sees-nine-labelled-frames.
 */
import {
  analysisSampleTimes, coverageNote, locatePlanFor, longEdgeResize, sampleCoverage,
  SWING_ANALYSIS_FRAME_COUNT,
} from '../../services/swing/analysisFrames';

describe('nine frames, evenly spaced across the window', () => {
  it('is nine', () => {
    expect(SWING_ANALYSIS_FRAME_COUNT).toBe(9);
  });

  it('a located window inside the clip is sampled end to end, evenly', () => {
    const s = analysisSampleTimes(1200, 1600, 5533);
    expect(s).toHaveLength(9);
    expect(s[0].tMs).toBe(1200);
    expect(s[8].tMs).toBe(2800);
    const gaps = s.slice(1).map((x, i) => x.tMs - s[i].tMs);
    for (const g of gaps) expect(Math.abs(g - 200)).toBeLessThanOrEqual(1);
    expect(s[0].fraction).toBe(0);
    expect(s[8].fraction).toBe(1);
  });

  it('a window touching the clip edges is pulled in, never sampled at 0 or the last millisecond', () => {
    const s = analysisSampleTimes(0, 5533, 5533);
    expect(s[0].tMs).toBeGreaterThan(0);
    expect(s[8].tMs).toBeLessThan(5533);
    for (const x of s) {
      expect(x.tMs).toBeGreaterThanOrEqual(0);
      expect(x.tMs).toBeLessThanOrEqual(5533);
    }
  });

  it('refuses a degenerate window instead of inventing times', () => {
    for (const bad of [0, -5, NaN, Infinity]) expect(analysisSampleTimes(0, bad, 5000)).toEqual([]);
  });
});

describe('frames are sized by the LONG edge', () => {
  it('portrait (how most swings are filmed) resizes the height', () => {
    expect(longEdgeResize(1080, 1920, 768)).toEqual({ height: 768 });
  });

  it('landscape resizes the width', () => {
    expect(longEdgeResize(1920, 1080, 768)).toEqual({ width: 768 });
  });

  it('never upscales a small frame', () => {
    expect(longEdgeResize(360, 640, 768)).toEqual({ height: 640 });
  });

  it('unknown dimensions keep the historical width form rather than guessing', () => {
    expect(longEdgeResize(undefined, undefined, 768)).toEqual({ width: 768 });
  });
});

describe('which clips get located', () => {
  it("Tim's 5.5s clip is located on the device (it used to skip locating)", () => {
    expect(locatePlanFor(5533)).toBe('on_device_only');
  });

  it('the 2.5s floor and the 6s network threshold', () => {
    expect(locatePlanFor(2499)).toBe('none');
    expect(locatePlanFor(2500)).toBe('on_device_only');
    expect(locatePlanFor(5999)).toBe('on_device_only');
    expect(locatePlanFor(6000)).toBe('full');
    expect(locatePlanFor(0)).toBe('none');
    expect(locatePlanFor(NaN)).toBe('none');
  });
});

describe('the coverage line says what the read was built on', () => {
  it('a found window is "found your swing"', () => {
    const cov = sampleCoverage([1.2, 1.4, 2.8], { startSec: 1.2, endSec: 2.8 }, 5533);
    expect(cov).toEqual({ start_sec: 1.2, end_sec: 2.8, frames: 3, whole_clip: false });
    expect(coverageNote(cov, { top: true, impact: true })).toEqual({
      key: 'frames_found_swing', params: { start: '1.2', end: '2.8', frames: 3 }, missedTopAndImpact: false,
    });
  });

  it('no window, or a window that is the clip, is "clip covers"', () => {
    expect(sampleCoverage([0.3, 5.2], null, 5533)!.whole_clip).toBe(true);
    expect(sampleCoverage([0.3, 5.2], { startSec: 0, endSec: 5.533 }, 5533)!.whole_clip).toBe(true);
  });

  it('adds the low-confidence reason only when neither the top nor impact was seen', () => {
    const cov = sampleCoverage([1, 2], { startSec: 1, endSec: 2 }, 5000);
    expect(coverageNote(cov, { top: false, impact: false })!.missedTopAndImpact).toBe(true);
    expect(coverageNote(cov, { top: true, impact: false })!.missedTopAndImpact).toBe(false);
    expect(coverageNote(cov, null)!.missedTopAndImpact).toBe(false);
  });

  it('says nothing when there were no frames', () => {
    expect(sampleCoverage([], null, 5000)).toBeNull();
    expect(coverageNote(null, null)).toBeNull();
  });
});
