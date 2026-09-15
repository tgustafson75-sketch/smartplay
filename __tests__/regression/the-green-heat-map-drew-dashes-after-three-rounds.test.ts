/**
 * 2026-09-14 (Tim — "in dashboard check green heat map card. It should now populate after rounds
 * after yesterday's work but it may not be wired to show green heat map for the user and GIR etc.")
 *
 * It did not populate, and the reason was not the 09-13 extraction — that was sound. Par was
 * resolved ONLY through `holesByCourse`, which `greenHeatInput` fills with the ACTIVE course's
 * holes. You open the scorecard after a round; there is no active course. So with three complete
 * rounds logged the model reported:
 *
 *     ready=true  totalHoles=54  approach.holes=0  scramble.holes=0
 *
 * — past the honesty floor, out of the "collecting your putts" state, and rendering a grid of
 * dashes. The card looked broken precisely because it had enough data to stop apologising.
 *
 * Every RoundRecord already carries `holePars`, preserved deliberately by
 * `compactHistoryForPersist` and read by `scoredRoundStats` for the caddie's GIR answer. The heat
 * map was the one consumer that never looked at it.
 *
 * This test fails on the pre-fix code at the two `.holes` assertions.
 */
import { greenHeatInput } from '../../services/putting/greenHeatInput';
import { buildGreenHeatModel } from '../../services/putting/greenHeat';
import { isGirHole, girFrom, scoredRoundFromRecord } from '../../services/round/scoredRoundStats';

/**
 * A finished round with real pars on the record. `hit` holes are greens in regulation (par − 2 to
 * the green), the rest are scrambles — so both buckets are genuinely populated and a fix that
 * classified everything into one of them would not pass.
 */
function finishedRound(id: string, courseId: string) {
  const scores: Record<number, number> = {};
  const putts: Record<number, number> = {};
  const holePars: Record<number, number> = {};
  for (let h = 1; h <= 18; h++) {
    const par = h % 3 === 0 ? 3 : h % 5 === 0 ? 5 : 4;
    holePars[h] = par;
    const gir = h % 2 === 0;
    putts[h] = h % 4 === 0 ? 1 : 2;
    // GIR: on the green in par − 2. Scramble: one more than that.
    scores[h] = (par - 2) + putts[h] + (gir ? 0 : 1);
  }
  return { id, courseId, scores, putts, holePars, simulated: false } as never;
}

describe('the green heat map after real rounds', () => {
  const history = [finishedRound('r1', 'c1'), finishedRound('r2', 'c1'), finishedRound('r3', 'c2')];

  /** Exactly the state the scorecard is in when you open it after a round: nothing active. */
  const offRound = {
    roundHistory: history,
    activeCourseId: null,
    courseHoles: null,
    scores: {},
    putts: {},
    isRoundActive: false,
    isSimRound: false,
  };

  it('classifies every hole off-round, from the pars stored on the round itself', () => {
    const { rounds, holesByCourse } = greenHeatInput(offRound, 'career');
    // The precondition that made this invisible: there is no course lookup at all off-round.
    expect(Object.keys(holesByCourse)).toHaveLength(0);

    const m = buildGreenHeatModel(rounds, holesByCourse);
    expect(m.ready).toBe(true);
    expect(m.totalHoles).toBe(54);
    // THE BUG: both of these were 0 — a ready card with nothing in either cell.
    expect(m.byClass.approachPutt.holes).toBeGreaterThan(0);
    expect(m.byClass.scramblePutt.holes).toBeGreaterThan(0);
    expect(m.byClass.approachPutt.holes + m.byClass.scramblePutt.holes).toBe(54);
    // And the cells the card actually renders must carry a number, not a dash.
    expect(m.byClass.approachPutt.onePuttRate).not.toBeNull();
    expect(m.byClass.scramblePutt.onePuttRate).not.toBeNull();
  });

  it('a round at a course with no stored pars still counts toward overall, never guessed into a class', () => {
    const noPars = { ...(finishedRound('r4', 'c9') as unknown as Record<string, unknown>) };
    delete noPars.holePars;
    const { rounds, holesByCourse } = greenHeatInput(
      { ...offRound, roundHistory: [noPars as never] }, 'career',
    );
    const m = buildGreenHeatModel(rounds, holesByCourse);
    expect(m.totalHoles).toBe(18);
    expect(m.byClass.approachPutt.holes).toBe(0);
    expect(m.byClass.scramblePutt.holes).toBe(0);
  });

  it('the heat map and the caddie agree about which holes were greens in regulation', () => {
    // One rule, three former copies. If greenHeat ever re-derives its own, these two diverge.
    const { rounds, holesByCourse } = greenHeatInput(offRound, 'career');
    const m = buildGreenHeatModel(rounds, holesByCourse);
    const caddieHit = history.reduce((n, r) => n + girFrom(scoredRoundFromRecord(r)).hit, 0);
    expect(m.byClass.approachPutt.holes).toBe(caddieHit);
  });

  it('a hole that cannot be judged is null, not a missed green', () => {
    expect(isGirHole(4, 2, 4)).toBe(true);
    expect(isGirHole(5, 2, 4)).toBe(false);
    expect(isGirHole(4, undefined, 4)).toBeNull();   // no putt count logged
    expect(isGirHole(0, 2, 4)).toBeNull();           // hole not scored
    expect(isGirHole(4, 2, undefined)).toBeNull();   // par unknown
  });
});
