/**
 * 2026-10-15 (review) — a twice-around round (9-hole course, 18 format) holds the nine expanded to
 * 18. startRound passed that expanded list to prefetchRoundData, so fetchCourseContent generated and
 * saved notes for holes 10-18 of a course that has nine. caddie.tsx already writes only ≤9 to the
 * course book for exactly this reason; the prefetch now does the same.
 */
const prefetchRoundData = jest.fn(async () => 0);
jest.mock('../../services/roundPrefetch', () => ({ prefetchRoundData }));

import { useRoundStore } from '../../store/roundStore';

const nine = Array.from({ length: 9 }, (_, i) => ({ hole: i + 1, par: 4, distance: 350 }));
const expanded = [...nine, ...nine.map((h) => ({ ...h, hole: h.hole + 9 }))];

describe('round prefetch sees the course, not the doubled round', () => {
  beforeEach(() => { prefetchRoundData.mockClear(); useRoundStore.setState({ roundHistory: [], isRoundActive: false } as never); });

  it('twice around → the real nine holes only', () => {
    useRoundStore.getState().startRound('Echo Hills', expanded as never, {
      nineHole: false, startHole: 1, isCompetition: false, notes: '', goal: null, courseId: 'echo', twiceAround: true,
    } as never);
    expect(prefetchRoundData).toHaveBeenCalledTimes(1);
    const holes = (prefetchRoundData.mock.calls[0] as unknown as [{ holes: { hole: number }[] }])[0].holes;
    expect(holes.map((h) => h.hole)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    // the round itself still plays 18
    expect(useRoundStore.getState().courseHoles).toHaveLength(18);
  });

  it('a real 18 is unchanged', () => {
    const eighteen = Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, distance: 350 }));
    useRoundStore.getState().startRound('Real 18', eighteen as never, {
      nineHole: false, startHole: 1, isCompetition: false, notes: '', goal: null, courseId: 'r18',
    } as never);
    const holes = (prefetchRoundData.mock.calls[0] as unknown as [{ holes: unknown[] }])[0].holes;
    expect(holes).toHaveLength(18);
  });
});
