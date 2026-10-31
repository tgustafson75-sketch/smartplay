/**
 * 2026-10-31 (Brain recheck r27, BRAIN-AR-R27-2) — A PAR ANSWER IS THE WHOLE UTTERANCE.
 *
 * With "what's the par?" open after "I made a bogey on 7", any sentence containing "five" or "three" was read as the par:
 * "what's the five iron good for into that green?" set par 5 on hole 7 and persisted it, the bogey was logged against it,
 * and the question was swallowed before the brain heard it. Only a whole-utterance answer is a par now; anything else
 * closes the question and falls through. "it's a five", "par five" and "par 5" still answer.
 *
 * BEHAVIOURAL: the real pendingParAsk and roundStore; no mocks.
 */
import { useRoundStore } from '../../store/roundStore';
import { markAwaitingPar, parseParAnswer, tryAnswerPendingPar, clearAwaitingPar } from '../../services/pendingParAsk';

// Hole 7 has no par on the card, so the caddie has to ask.
const card = Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: i === 6 ? 0 : 4, distance: 380 }));
function fresh() {
  useRoundStore.setState({ roundHistory: [] } as never);
  useRoundStore.getState().startRound('Par GC', card as never, {
    nineHole: false, startHole: 1, isCompetition: false, notes: '', goal: null, courseId: 'par-gc-27',
  } as never);
  clearAwaitingPar();
}

describe('a par answer that is a sentence is not a par', () => {
  beforeEach(fresh);

  it('"what\'s the five iron good for into that green?" is not a par and sets nothing', () => {
    markAwaitingPar(7, 'I made a bogey on 7');
    expect(tryAnswerPendingPar("what's the five iron good for into that green?")).toBeNull();
    expect(useRoundStore.getState().courseHoles.find((h) => h.hole === 7)?.par).toBe(0);
    expect(useRoundStore.getState().scores[7]).toBeUndefined();
  });

  it('"about three hundred yards to the water" is not a par and sets nothing', () => {
    markAwaitingPar(7, 'I made a bogey on 7');
    expect(tryAnswerPendingPar('about three hundred yards to the water')).toBeNull();
    expect(useRoundStore.getState().courseHoles.find((h) => h.hole === 7)?.par).toBe(0);
  });

  it('the answers that are a par still answer: "it\'s a five" fills the par and logs the bogey on it', () => {
    markAwaitingPar(7, 'I made a bogey on 7');
    const r = tryAnswerPendingPar("it's a five");
    expect(r?.par).toBe(5);
    expect(r?.strokes).toBe(6);
    expect(useRoundStore.getState().courseHoles.find((h) => h.hole === 7)?.par).toBe(5);
  });

  it('parseParAnswer accepts whole-utterance par answers and nothing inside a sentence', () => {
    expect(parseParAnswer('par five')).toBe(5);
    expect(parseParAnswer('par 5')).toBe(5);
    expect(parseParAnswer('Three.')).toBe(3);
    expect(parseParAnswer('it is a four')).toBe(4);
    expect(parseParAnswer('what is the five iron good for')).toBeNull();
    expect(parseParAnswer('three hundred yards')).toBeNull();
    expect(parseParAnswer('par 5 iron into that green')).toBeNull();
  });
});
