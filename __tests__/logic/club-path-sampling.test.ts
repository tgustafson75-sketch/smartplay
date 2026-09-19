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

  /**
   * 2026-09-19 — THIS TEST PASSED WHILE THE THING IT IS NAMED FOR WAS STILL BROKEN.
   *
   * It compared the anchored schedule against the UNANCHORED one — a comparison with something
   * worse, which the 09-01 change was always going to win. Measured on the real function after
   * that change, the downswing got TWO samples out of fourteen, which is the exact number the
   * 09-01 note describes as the bug ("getting one or two frames out of fourteen"). The window had
   * narrowed; the density inside it never arrived.
   *
   * Now absolute, and worth more than tidiness: around the top the clubhead is nearly stationary,
   * so samples there come back at almost the same coordinates and the arc gate dedupes them into
   * ONE point. Frames spent where the club barely moves can add nothing at all. The downswing is
   * where the head travels far enough between frames to give an arc DISTINCT points.
   */
  it('spends real density on the downswing, not just more than the old schedule', () => {
    const inDownswing = (t: number) => t >= IMPACT - 300 && t <= IMPACT;
    const off = clubPathSampleOffsets(START, END, IMPACT);
    const anchored = off.filter(inDownswing).length;
    expect(anchored).toBeGreaterThanOrEqual(6);                       // was 2
    expect(anchored).toBeGreaterThan(off.filter((t) => t < IMPACT - 900).length);
    // ...and still beats the unanchored schedule, which is what this test used to say.
    expect(anchored).toBeGreaterThan(clubPathSampleOffsets(START, END, null).filter(inDownswing).length);
  });

  /**
   * 2026-09-19 — THE STRIKE FRAME, WHICH WAS NEVER SAMPLED.
   *
   * Every band samples its `from` and steps forward, so a band's END is never taken. The anchor is
   * a band boundary, so the one frame whose position says where the arc passes the ball was only
   * ever captured by coincidence — and on the nominal segment, measured, it never was.
   */
  it('always samples the strike itself', () => {
    for (const impact of [2500, 1200, 3600, 300]) {
      expect(clubPathSampleOffsets(START, END, impact)).toContain(impact);
    }
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
  /**
   * 2026-09-19 — RESTATED AGAINST A CEILING THAT NOW EXISTS.
   *
   * This asserted a flat `toHaveLength(budget)` for every case including a 600ms window. That was
   * right while the only limit was arithmetic, and it became wrong the moment the schedule started
   * refusing to ask for two offsets that decode the SAME frame: a 600ms clip at 30fps holds
   * eighteen frames, and the bands inside it hold fewer still, so fourteen DISTINCT samples is not
   * a thing that exists to be spent. Padding the count with re-decodes of frames we already have
   * is not spending the budget — it costs a decode, a downscale and a vision-model frame, and the
   * arc gate then dedupes the identical detections back out.
   *
   * So: the full budget wherever the window can hold it, every distinct frame it has where it
   * cannot, and NEVER two offsets on one frame. The original intent — the hardest reads must not
   * silently get fewer frames — is asserted on the cases where it is physically possible.
   */
  const FRAME_MS_30 = 1000 / 30;
  const distinctFrames = (off: number[]) => new Set(off.map((t) => Math.floor(t / FRAME_MS_30))).size;

  it('spends the full frame budget wherever the window can physically hold it', () => {
    const roomy: [number, number, number | null, number][] = [
      [0, 4000, 2500, 0],      // centred, confident
      [0, 4000, 3900, 0],      // anchor hard against the end
      [0, 4000, 2500, 5000],   // tolerance wider than the whole window
      [0, 4000, 2500, 240],    // a thin range/sim pickup
      [0, 4000, null, 0],      // no anchor at all
    ];
    const budget = clubPathSampleOffsets(0, 4000, 2500, 0).length;
    expect(budget).toBeGreaterThan(8);
    for (const [a, b, imp, tol] of roomy) {
      const off = clubPathSampleOffsets(a, b, imp, tol);
      expect(off).toHaveLength(budget);          // never fewer where the read is hardest
      expect(new Set(off).size).toBe(budget);    // and never a duplicated offset padding the count
    }
  });

  it('never asks for two offsets that decode the SAME frame', () => {
    const everything: [number, number, number | null, number][] = [
      [0, 4000, 2500, 0], [0, 4000, 120, 0], [0, 4000, 3900, 0], [0, 600, 300, 0],
      [0, 400, 250, 0], [0, 300, null, 0], [0, 4000, 2500, 5000], [0, 4000, null, 0],
    ];
    for (const [a, b, imp, tol] of everything) {
      const off = clubPathSampleOffsets(a, b, imp, tol);
      // Every offset is its own frame: a re-decode costs a native grab AND a vision-model frame,
      // and returns coordinates the gate then dedupes away. Budget spent to lower the point count.
      expect(distinctFrames(off)).toBe(off.length);
    }
  });

  /**
   * 2026-09-19 — a SHORT window keeps every frame it has rather than collapsing.
   *
   * Before the frame ceiling, an anchor 120ms into the window produced 14 offsets covering 8
   * distinct frames. The six re-decodes were pure loss. Capping each band at what it can hold and
   * handing the surplus to bands with room recovers them as real samples.
   */
  it('a cramped window still gets most of the budget, as DISTINCT frames', () => {
    const off = clubPathSampleOffsets(0, 4000, 120, 0);
    expect(off.length).toBeGreaterThanOrEqual(11);
    expect(distinctFrames(off)).toBe(off.length);
  });

  it('is monotonic — the frames are read in time order', () => {
    const off = clubPathSampleOffsets(START, END, IMPACT);
    for (let i = 1; i < off.length; i++) expect(off[i]).toBeGreaterThanOrEqual(off[i - 1]);
  });
});
