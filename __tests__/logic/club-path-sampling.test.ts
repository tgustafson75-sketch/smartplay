/**
 * 2026-09-01 (Tim — "I've only seen the club arc show up sporadically and mostly incorrect, where it
 * doesn't anchor on the ball box. It may get the direction right, but it looks like it's BEHIND the
 * user") — WHICH FRAMES INSIDE THE SWING WINDOW GET SAMPLED.
 *
 * The old schedule put 70% of the samples in the last 55% of the window BY FRACTION. The segmenter
 * cuts 2,500ms before the strike and 1,500ms after, so that dense half ran to the last frame of the
 * clip — and past roughly 400ms after impact the clubhead is back over the player's shoulder. Real
 * detections, drawn as an arc behind the golfer. Meanwhile the downswing that actually shapes the arc
 * through the ball got one or two frames out of fourteen.
 */
import { clubPathSampleOffsets } from '../../services/swing/clubPath';

/** The segmenter's own shape: 2,500ms before the strike, 1,500ms after. */
const START = 0, IMPACT = 2500, END = 4000;

describe('clubPathSampleOffsets', () => {
  it('puts most of the samples around impact when the strike is known', () => {
    const off = clubPathSampleOffsets(START, END, IMPACT);
    const nearImpact = off.filter((t) => t >= IMPACT - 900 && t <= IMPACT + 450);
    expect(nearImpact.length / off.length).toBeGreaterThan(0.5);
  });

  it('stops sampling deep follow-through — that is where the arc used to end up behind the player', () => {
    const off = clubPathSampleOffsets(START, END, IMPACT);
    const deepFollowThrough = off.filter((t) => t > IMPACT + 700);
    const oldSchedule = clubPathSampleOffsets(START, END, null);
    const oldDeep = oldSchedule.filter((t) => t > IMPACT + 700);
    expect(deepFollowThrough.length).toBeLessThan(oldDeep.length);
  });

  it('samples the downswing far more densely than the unanchored schedule did', () => {
    // The ~250ms before the ball is the part that shapes the arc.
    const inDownswing = (t: number) => t >= IMPACT - 300 && t <= IMPACT;
    const anchored = clubPathSampleOffsets(START, END, IMPACT).filter(inDownswing).length;
    const unanchored = clubPathSampleOffsets(START, END, null).filter(inDownswing).length;
    expect(anchored).toBeGreaterThan(unanchored);
  });

  it('still covers the start of the swing — the arc needs somewhere to come from', () => {
    const off = clubPathSampleOffsets(START, END, IMPACT);
    expect(off.filter((t) => t < IMPACT - 900).length).toBeGreaterThanOrEqual(2);
  });

  it('keeps the old fraction band when there is no honest anchor', () => {
    // Inventing a centre is worse than spreading wide. [[a-field-that-is-sometimes-a-placeholder]]
    const off = clubPathSampleOffsets(START, END, null);
    expect(off.length).toBeGreaterThan(8);
    expect(Math.min(...off)).toBe(START);
    expect(Math.max(...off)).toBeLessThanOrEqual(END);
  });

  it('refuses an anchor that falls outside the window rather than clustering on nothing', () => {
    const outside = clubPathSampleOffsets(START, END, 9_000);
    expect(outside).toEqual(clubPathSampleOffsets(START, END, null));
    expect(clubPathSampleOffsets(START, END, NaN)).toEqual(clubPathSampleOffsets(START, END, null));
    expect(clubPathSampleOffsets(START, END, START)).toEqual(clubPathSampleOffsets(START, END, null));
  });

  it('always stays inside the window, and never returns a degenerate schedule', () => {
    for (const anchor of [null, IMPACT, 500, 3900]) {
      const off = clubPathSampleOffsets(START, END, anchor);
      expect(off.length).toBeGreaterThan(4);
      for (const t of off) {
        expect(t).toBeGreaterThanOrEqual(START);
        expect(t).toBeLessThanOrEqual(END);
      }
    }
    expect(clubPathSampleOffsets(1000, 1000, null)).toEqual([]);
    expect(clubPathSampleOffsets(2000, 1000, 1500)).toEqual([]);
  });

  /**
   * 2026-09-02 (adversarial pass over the previous day's own work) — THE BUDGET IS ALWAYS SPENT.
   *
   * The first version allocated a fixed count per range and skipped any range that had collapsed, so
   * an anchor near an edge — or a LOW-CONFIDENCE strike whose tolerance widened the core past one —
   * silently returned 11 or 8 frames instead of 14. Exactly backwards: those are the hardest reads,
   * and a sparser arc looks like a hard-to-track swing rather than like a bug. [[overstrict-gate-lens]]
   */
  it('spends the full frame budget wherever the anchor sits and however wide the tolerance', () => {
    const cases: [number, number, number | null, number][] = [
      [0, 4000, 2500, 0],      // centred, confident
      [0, 4000, 120, 0],       // anchor hard against the start
      [0, 4000, 3900, 0],      // anchor hard against the end
      [0, 600, 300, 0],        // window shorter than the core band
      [0, 4000, 2500, 5000],   // tolerance wider than the whole window
      [0, 4000, 2500, 240],    // a thin range/sim pickup
      [0, 4000, null, 0],      // no anchor at all
    ];
    const budget = clubPathSampleOffsets(0, 4000, 2500, 0).length;
    expect(budget).toBeGreaterThan(8);
    for (const [a, b, imp, tol] of cases) {
      const off = clubPathSampleOffsets(a, b, imp, tol);
      expect(off).toHaveLength(budget);          // never fewer where the read is hardest
      expect(new Set(off).size).toBe(budget);    // and never a duplicated frame padding the count
    }
  });

  it('is monotonic — the frames are read in time order', () => {
    const off = clubPathSampleOffsets(START, END, IMPACT);
    for (let i = 1; i < off.length; i++) expect(off[i]).toBeGreaterThanOrEqual(off[i - 1]);
  });
});
