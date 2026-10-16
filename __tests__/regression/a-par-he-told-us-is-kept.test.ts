/**
 * 2026-10-15 (review) — "I got a bogey" on a hole whose card has no par: the caddie asks "what's the
 * par?", resolves the score from the answer — and threw the par away. The next named score on that
 * hole asked again, and vs-par never counted the hole. The answered par is now written into the
 * round's card row. Also: an answer arriving after End Round no longer claims "Got it".
 */
import { useRoundStore } from '../../store/roundStore';
import { markAwaitingPar, tryAnswerPendingPar } from '../../services/pendingParAsk';
import { markAwaitingPutts, tryAnswerPendingPutts } from '../../services/pendingPuttAsk';

const card = Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: i === 4 ? 0 : 4, distance: 380 }));
function fresh() {
  useRoundStore.setState({ roundHistory: [] } as never);
  useRoundStore.getState().startRound('Par GC', card as never, {
    nineHole: false, startHole: 1, isCompetition: false, notes: '', goal: null, courseId: 'par-gc',
  } as never);
}

describe('a par the player told us is kept', () => {
  beforeEach(fresh);

  it('answering "par four" fills the unknown par and vs-par counts the hole', () => {
    markAwaitingPar(5, 'I got a bogey');
    const r = tryAnswerPendingPar('par four');
    expect(r?.strokes).toBe(5);
    expect(useRoundStore.getState().courseHoles.find((h) => h.hole === 5)?.par).toBe(4);
    expect(useRoundStore.getState().getScoreVsPar()).toBe(1);
  });

  it('a spoken par never overwrites a real scorecard par', () => {
    (useRoundStore.getState() as unknown as { setHolePar: (h: number, p: number) => void }).setHolePar(3, 5);
    expect(useRoundStore.getState().courseHoles.find((h) => h.hole === 3)?.par).toBe(4);
  });
});

describe('an answer after End Round is not claimed', () => {
  beforeEach(fresh);

  it('putts: no "Got it" for a count that could not be kept', () => {
    useRoundStore.getState().logScore(1, 5);
    markAwaitingPutts(1);
    useRoundStore.getState().endRound();
    expect(tryAnswerPendingPutts('two')).toBeNull();
  });

  it('par: no score line after the round ended', () => {
    markAwaitingPar(5, 'I got a bogey');
    useRoundStore.getState().endRound();
    expect(tryAnswerPendingPar('par four')).toBeNull();
  });
});
