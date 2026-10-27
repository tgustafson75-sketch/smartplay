/**
 * 2026-10-26 (audit C2) — SmartMotion's re-analyze passed segments[0] whatever swing was on screen, and
 * runAnalysis waits on (and shows) the read of the swing that segment numbers — so re-analyzing swing 3
 * of a reel put swing 1's verdict over swing 3. The screen now asks reanalyzeSegment for the segment.
 */
import { reanalyzeSegment, type SwingSegment } from '../../services/swing/swingSegmentation';

const seg = (index: number, strikeMs: number): SwingSegment => ({ index, strikeMs, startMs: strikeMs - 2500, endMs: strikeMs + 1500, confidence: 'high', peakDb: -12, confirmed: true });

describe('re-analyze waits on the swing on screen', () => {
  const reel = [seg(1, 3000), seg(2, 11000), seg(3, 19000)];
  it('swing 3 selected → swing 3\'s segment, numbered 3 (runAnalysis waits on shot index 2)', () => {
    const s = reanalyzeSegment(reel, 2)!;
    expect(s.strikeMs).toBe(19000);
    expect(s.index - 1).toBe(2);
  });
  it('the number is the swing\'s place in the reel, even if a dropped swing left a gap in the indices', () => {
    const s = reanalyzeSegment([seg(1, 3000), seg(3, 19000)], 1)!;
    expect(s.strikeMs).toBe(19000);
    expect(s.index).toBe(2);
  });
  it('a selection off the end falls back to swing 1; no segments → none', () => {
    expect(reanalyzeSegment(reel, 7)!.strikeMs).toBe(3000);
    expect(reanalyzeSegment([], 0)).toBeUndefined();
  });
});
