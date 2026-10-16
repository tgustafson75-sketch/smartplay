/**
 * 2026-10-15 (review) —
 *  (9) "I made a 5 with two putts" wrote the score, then the putts, as two mutations; "scratch that"
 *      undid only the putts and the 5 stood. One utterance is now one undoable mutation.
 * (14) logScore / logPutts had no round-active guard: a putt count answered after End Round (the
 *      open "how many putts?") or a par answered late went into the idle store.
 */
import { useRoundStore } from '../../store/roundStore';
import { logScoreHandler } from '../../services/intents/logScoreHandler';
import { tryAnswerPendingPutts, markAwaitingPutts } from '../../services/pendingPuttAsk';

const card = Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, distance: 380 }));
function fresh() {
  useRoundStore.setState({ roundHistory: [] } as never);
  useRoundStore.getState().startRound('Undo GC', card as never, {
    nineHole: false, startHole: 1, isCompetition: false, notes: '', goal: null, courseId: 'undo',
  } as never);
}

describe('scratch that after a score stated with its putts', () => {
  beforeEach(fresh);

  it('undoes the score AND the putts, and restores the hole', async () => {
    await logScoreHandler.execute({ intent_type: 'log_score', parameters: {}, raw_text: 'I made a five with two putts', confidence: 'high' } as never, {} as never);
    expect(useRoundStore.getState().scores[1]).toBe(5);
    expect(useRoundStore.getState().putts[1]).toBe(2);
    useRoundStore.getState().undoLastMutation();
    expect(useRoundStore.getState().scores[1]).toBeUndefined();
    expect(useRoundStore.getState().putts[1]).toBeUndefined();
    expect(useRoundStore.getState().currentHole).toBe(1);
  });

  it('a correction stated with putts restores the prior score and prior putts', () => {
    const r = useRoundStore.getState();
    r.logScore(3, 6); r.logPutts(3, 3);
    (useRoundStore.getState() as unknown as { logScoreWithPutts: (h: number, s: number, p: number) => void }).logScoreWithPutts(3, 5, 2);
    useRoundStore.getState().undoLastMutation();
    expect(useRoundStore.getState().scores[3]).toBe(6);
    expect(useRoundStore.getState().putts[3]).toBe(3);
  });
});

describe('no round, no write', () => {
  beforeEach(fresh);

  it('a putt answer after End Round is not stored in the idle store', () => {
    useRoundStore.getState().logScore(1, 5);
    markAwaitingPutts(1);
    useRoundStore.getState().endRound();
    tryAnswerPendingPutts('two');
    expect(useRoundStore.getState().putts[1]).toBeUndefined();
  });

  it('logScore and logPutts refuse while no round is active', () => {
    useRoundStore.getState().endRound();
    useRoundStore.getState().logScore(2, 4);
    useRoundStore.getState().logPutts(2, 2);
    expect(useRoundStore.getState().scores[2]).toBeUndefined();
    expect(useRoundStore.getState().putts[2]).toBeUndefined();
  });
});
