/**
 * 2026-09-03 — the scorecard and the store disagreed about what "played" means.
 *
 * roundStore guards against a 0-score hole in three places — getHolesPlayed ("a 0-score in-progress
 * hole must not inflate the count"), getScoreVsPar, and the round-record builder. The scorecard
 * guarded in none: it counted Object.keys(viewScores), so a hole present with a score of 0 counted
 * as played AND added its par to totalPar while adding nothing to totalScore. vs-par then read one
 * par WORSE per such hole — the same family as the "-60 under" and "+41 vs par" bugs already fixed
 * on that screen.
 *
 * This pins the shared meaning of "scored" rather than the screen's rendering.
 */
const scoredHoleNums = (scores: Record<number, number>) =>
  new Set(Object.entries(scores).filter(([, v]) => v > 0).map(([n]) => Number(n)));

const totals = (scores: Record<number, number>, pars: Record<number, number>) => {
  const scored = scoredHoleNums(scores);
  const totalScore = Object.values(scores).reduce((a, b) => a + b, 0);
  const totalPar = [...scored].reduce((a, h) => a + (pars[h] ?? 0), 0);
  return { holesPlayed: scored.size, totalScore, totalPar, vsPar: totalScore - totalPar };
};

describe('scorecard totals', () => {
  const pars = { 1: 4, 2: 4, 3: 3 };

  it('ignores a 0-score hole entirely', () => {
    const t = totals({ 1: 5, 2: 4, 3: 0 }, pars);
    expect(t.holesPlayed).toBe(2);
    expect(t.totalPar).toBe(8);      // hole 3's par 3 must NOT be counted
    expect(t.vsPar).toBe(1);         // 9 shot against 8 par
  });

  it('was the bug: counting the 0 hole makes vs-par one par worse', () => {
    // The old behaviour, reproduced — holesPlayed 3 and totalPar 11 gives +(-2), a full par adrift.
    const oldTotalPar = Object.keys({ 1: 5, 2: 4, 3: 0 }).reduce((a, h) => a + (pars[Number(h) as 1] ?? 0), 0);
    expect(oldTotalPar).toBe(11);
    expect(9 - oldTotalPar).toBe(-2);   // reads as 2 UNDER
    expect(totals({ 1: 5, 2: 4, 3: 0 }, pars).vsPar).toBe(1); // truth: 1 over
  });

  it('is unchanged when every hole has a real score', () => {
    const t = totals({ 1: 4, 2: 5, 3: 3 }, pars);
    expect(t.holesPlayed).toBe(3);
    expect(t.totalPar).toBe(11);
    expect(t.vsPar).toBe(1);
  });

  it('an empty card is not a round under par', () => {
    const t = totals({}, pars);
    expect(t.holesPlayed).toBe(0);
    expect(t.vsPar).toBe(0);
  });
});
