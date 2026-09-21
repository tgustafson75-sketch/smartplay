/**
 * 2026-09-20 (Tim, from Echo Hills) — "Check all scoring logic and handicap scoring for 9 holes."
 *
 * Echo Hills is nine holes, par 35, and its card carries NO rating or slope. handicapQueryHandler
 * sums the loaded holes for `par` (35) and, with no rating, called
 * `computeCourseHandicap(idx, par, 113, par)` — which reduces to exactly `idx`. So the caddie told
 * an 18-index player "your Course Handicap would be about 18" on a nine-hole course, and said it as
 * fact. WHS: a nine-hole Course Handicap uses HALF the Index against the nine's own rating and par,
 * so the answer is about 9.
 *
 * WHAT MUST NOT MOVE: the round POSTING path. roundStore passes a full-index course handicap and
 * allocates over eighteen, which nets out correct on a nine (an 18-index gets one stroke a hole
 * either way). Those two errors cancel exactly, so both functions default to 18 and posting is
 * byte-identical. Un-cancelling only one half is worse than leaving both.
 */
import {
  computeCourseHandicap, strokesReceivedOnHole, computeWhsPostingScore,
} from '../../services/handicapCalculator';

const ECHO_PARS: Record<number, number> = { 1:4, 2:3, 3:4, 4:4, 5:4, 6:4, 7:4, 8:4, 9:4 }; // par 35

describe('a nine-hole course handicap is not an eighteen-hole one', () => {
  it('halves the Index for a nine, and leaves eighteen alone', () => {
    // Echo Hills shape: no rating on the card, so rating and par are both the nine's par.
    expect(computeCourseHandicap(18, 35, 113, 35, 18)).toBe(18); // the bug: an eighteen's answer
    expect(computeCourseHandicap(18, 35, 113, 35, 9)).toBe(9);   // the nine's answer
    expect(computeCourseHandicap(25, 35, 113, 35, 9)).toBe(13);
    // A real eighteen is untouched.
    expect(computeCourseHandicap(18, 72, 113, 72)).toBe(18);
    expect(computeCourseHandicap(18, 75.5, 145, 72)).toBe(27);
  });

  it('defaults to eighteen, so no existing caller changes', () => {
    expect(computeCourseHandicap(18, 72, 113, 72)).toBe(computeCourseHandicap(18, 72, 113, 72, 18));
    expect(strokesReceivedOnHole(14, 3)).toBe(strokesReceivedOnHole(14, 3, 18));
  });

  it('allocates a nine-hole handicap over nine holes', () => {
    // The case where the two errors STOP cancelling: a 15 over nine is two strokes on the six
    // hardest, not one stroke everywhere.
    const overNine = [1,2,3,4,5,6,7,8,9].map((i) => strokesReceivedOnHole(15, i, 9));
    expect(overNine).toEqual([2,2,2,2,2,2,1,1,1]);
    expect(overNine.reduce((a, b) => a + b, 0)).toBe(15);

    // Spread over eighteen instead, the same number silently hands out nine strokes, not fifteen.
    const overEighteen = [1,2,3,4,5,6,7,8,9].map((i) => strokesReceivedOnHole(15, i, 18));
    expect(overEighteen.reduce((a, b) => a + b, 0)).toBe(9);
  });

  it('a nine-hole handicap allocates its full stroke count', () => {
    for (const ch of [4, 9, 10, 14, 18, 27]) {
      const total = [1,2,3,4,5,6,7,8,9]
        .map((i) => strokesReceivedOnHole(ch, i, 9))
        .reduce((a, b) => a + b, 0);
      expect({ ch, total }).toEqual({ ch, total: ch });
    }
  });

  it('POSTING is unchanged — the cancelling pair stays cancelling', () => {
    const scores: Record<number, number> = { 1:6, 2:4, 3:5, 4:5, 5:7, 6:5, 7:5, 8:6, 9:5 }; // 48
    for (const ch of [4, 9, 14, 18, 27]) {
      const post = computeWhsPostingScore({ intendedHoles: 9, courseHandicap: ch, pars: ECHO_PARS, scores });
      expect(post).not.toBeNull();
      expect(post!.postedHoles).toBe(9);
      expect(post!.playedHoles).toBe(9);
    }
    // The exact figures Echo Hills produced before this change, pinned so posting cannot drift.
    expect(computeWhsPostingScore({ intendedHoles: 9, courseHandicap: 4, pars: ECHO_PARS, scores })!.adjustedGrossScore).toBe(47);
    expect(computeWhsPostingScore({ intendedHoles: 9, courseHandicap: 18, pars: ECHO_PARS, scores })!.adjustedGrossScore).toBe(48);
  });
});
