import { useCaddieMemoryStore } from '../../store/caddieMemoryStore';

/**
 * 2026-08-23 — the LEARN step was dropping the most coachable half of every round.
 *
 * recordRoundEnd learned score, tee club, approach club and trouble, and threw away putts, greens
 * and fairways — which roundStore had already computed per hole. The model could tell you that you
 * average 5.2 on this hole and never that you three-putt its green half the time, permanently,
 * across every round you have ever played.
 */
describe('the caddie learns HOW the score happened', () => {
  const CID = 'greenhill';
  beforeEach(() => useCaddieMemoryStore.setState({ players: {} } as never));

  const play = (putts: number, girHit: boolean | null, fairwayHit: boolean | null, score = 5) =>
    useCaddieMemoryStore.getState().recordRoundEnd({
      round_id: `r${Math.random()}`, course_id: CID, nowMs: Date.now(),
      holes: [{ hole: 7, par: 4, score, putts, girHit, fairwayHit }],
    });

  const hole7 = () => useCaddieMemoryStore.getState().getPlayer().courses[CID].holes[7];

  it('remembers putts per hole across rounds', () => {
    play(3, false, true);
    play(1, true, true);
    expect(hole7().puttsAvg).toBe(2);
  });

  it('learns a three-putt RATE, which is the coachable fact', () => {
    play(3, false, true);
    play(3, false, true);
    play(2, true, true);
    expect(hole7().threePuttRate).toBeCloseTo(0.67, 1);
  });

  it('an UNSURVEYED green is never learned as a missed one', () => {
    play(2, null, null);
    expect(hole7().girRate).toBeNull();
    expect(hole7().fairwayRate).toBeNull();
    // and a later round that DOES know starts the average honestly at 1, not 0.5
    play(2, true, true);
    expect(hole7().girRate).toBe(1);
  });

  it('still learns everything it learned before', () => {
    useCaddieMemoryStore.getState().recordRoundEnd({
      round_id: 'r1', course_id: CID, nowMs: Date.now(),
      holes: [{ hole: 7, par: 4, score: 6, teeClub: 'Driver', approachClub: '7 Iron', trouble: ['played 2+ over'] }],
    });
    expect(hole7().scoringAvg).toBe(6);
    expect(hole7().typicalTeeClub).toBe('Driver');
    expect(hole7().trouble).toContain('played 2+ over');
  });

  it('a hole recorded before these existed stays null rather than faking a zero', () => {
    useCaddieMemoryStore.getState().recordRoundEnd({
      round_id: 'r1', course_id: CID, nowMs: Date.now(), holes: [{ hole: 7, par: 4, score: 4 }],
    });
    expect(hole7().puttsAvg).toBeNull();
    expect(hole7().threePuttRate).toBeNull();
  });
});

describe('and then actually SAYS it', () => {
  const { getCaddieContext, MIN_HOLE_PLAYS_FOR_GUIDANCE } = require('../../services/caddieMemoryRetrieval') as typeof import('../../services/caddieMemoryRetrieval');
  const CID = 'greenhill';

  const playRounds = (n: number, putts: number) => {
    useCaddieMemoryStore.setState({ players: {} } as never);
    for (let i = 0; i < n; i++) {
      useCaddieMemoryStore.getState().recordRoundEnd({
        round_id: `r${i}`, course_id: CID, nowMs: Date.now(),
        holes: [{ hole: 7, par: 4, score: 5, putts, girHit: false, fairwayHit: true }],
      });
    }
  };

  it('tells the caddie about a three-putt habit once it is a pattern', () => {
    playRounds(MIN_HOLE_PLAYS_FOR_GUIDANCE, 3);
    const block = getCaddieContext({ courseId: CID, hole: 7 }).promptBlock;
    expect(block).toMatch(/three-putt this green/);
    expect(block).toMatch(/rarely hit this green in regulation/);
  });

  it('stays silent after ONE round — one round is not a pattern', () => {
    playRounds(1, 3);
    const block = getCaddieContext({ courseId: CID, hole: 7 }).promptBlock;
    expect(block).not.toMatch(/three-putt/);
    expect(block).not.toMatch(/rarely hit this green/);
  });

  it('reports a plain putting average when there is no three-putt habit', () => {
    playRounds(MIN_HOLE_PLAYS_FOR_GUIDANCE, 2);
    expect(getCaddieContext({ courseId: CID, hole: 7 }).promptBlock).toMatch(/average 2 putts here/);
  });
});
