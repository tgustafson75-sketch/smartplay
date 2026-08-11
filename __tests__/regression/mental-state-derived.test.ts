/**
 * 2026-08-10 (Tim, after his round) — "check the canned speech, because I again had like two pars
 * and one bogey, and it would tell me to forget the last three."
 *
 * ROOT CAUSE: mental state was ACCUMULATED by whichever surface happened to log the score.
 * updateMentalState was called from the caddie tab, the voice handler and the tool dispatch — but
 * NOT from the scorecard tab, which writes scores directly through roundStore.logScore. So a bad
 * hole logged by voice incremented the counter, while pars tapped on the scorecard never reset it.
 * The counter could only climb, and eventually the caddie told a man playing well to forget the
 * last three. A textbook missed producer ([[no-half-fixes-enforce-every-surface]]).
 *
 * FIX: derive from the real scorecard tail instead of trusting a running tally any surface can skip.
 * These lock the derivation — above all that Tim's actual stretch reads as fine.
 */
import { useRelationshipStore } from '../../store/relationshipStore';

const PAR = 4;
const set = (recent: { strokes: number; par: number }[]) => {
  useRelationshipStore.setState({ consecutiveBadHoles: 0, currentMentalState: 'neutral' } as never);
  useRelationshipStore.getState().recomputeMentalState(recent);
  return useRelationshipStore.getState();
};

describe("Tim's stretch must never read as a spiral", () => {
  it('two pars and a bogey → NOT spiraling', () => {
    const s = set([{ strokes: 4, par: PAR }, { strokes: 4, par: PAR }, { strokes: 5, par: PAR }]);
    expect(s.currentMentalState).not.toBe('spiraling');
    expect(s.consecutiveBadHoles).toBe(0);
  });

  it('a bogey after two pars ends any prior bad run — the counter cannot just climb', () => {
    // Simulates the real failure: earlier damage, then good golf. The good golf must win.
    useRelationshipStore.setState({ consecutiveBadHoles: 3, currentMentalState: 'spiraling' } as never);
    useRelationshipStore.getState().recomputeMentalState([
      { strokes: 7, par: PAR }, { strokes: 7, par: PAR }, { strokes: 7, par: PAR },
      { strokes: 4, par: PAR }, { strokes: 4, par: PAR }, { strokes: 5, par: PAR },
    ]);
    const s = useRelationshipStore.getState();
    expect(s.consecutiveBadHoles).toBe(0);
    expect(s.currentMentalState).not.toBe('spiraling');
  });

  it('a par leaves him confident', () => {
    expect(set([{ strokes: 5, par: PAR }, { strokes: 4, par: PAR }]).currentMentalState).toBe('confident');
  });

  it('bogeys alone never spiral — a bogey is a perfectly good result', () => {
    const s = set([{ strokes: 5, par: PAR }, { strokes: 5, par: PAR }, { strokes: 5, par: PAR }]);
    expect(s.consecutiveBadHoles).toBe(0);
    expect(s.currentMentalState).toBe('neutral');
  });
});

describe('a real spiral is still detected', () => {
  it('three straight doubles → spiraling', () => {
    const s = set([{ strokes: 6, par: PAR }, { strokes: 6, par: PAR }, { strokes: 6, par: PAR }]);
    expect(s.consecutiveBadHoles).toBe(3);
    expect(s.currentMentalState).toBe('spiraling');
  });

  it('two straight doubles → tight, not yet spiraling', () => {
    const s = set([{ strokes: 4, par: PAR }, { strokes: 6, par: PAR }, { strokes: 7, par: PAR }]);
    expect(s.consecutiveBadHoles).toBe(2);
    expect(s.currentMentalState).toBe('tight');
  });

  it('only the TRAILING run counts — old damage recovered from is not a spiral', () => {
    const s = set([{ strokes: 8, par: PAR }, { strokes: 8, par: PAR }, { strokes: 4, par: PAR }, { strokes: 6, par: PAR }]);
    expect(s.consecutiveBadHoles).toBe(1);
    expect(s.currentMentalState).not.toBe('spiraling');
  });
});

describe('never invent a bad hole from missing data', () => {
  it('no played holes → neutral', () => {
    expect(set([]).currentMentalState).toBe('neutral');
    expect(set([]).consecutiveBadHoles).toBe(0);
  });

  it('unscored / unknown-par holes are ignored rather than judged', () => {
    const s = set([{ strokes: 0, par: PAR }, { strokes: 6, par: 0 }, { strokes: 4, par: PAR }]);
    expect(s.consecutiveBadHoles).toBe(0);
    expect(s.currentMentalState).toBe('confident');
  });

  it('par-3s and par-5s are judged against their OWN par', () => {
    // A 5 on a par 5 is a par, not a bogey — judging against a default 4 would have called it bad.
    const s = set([{ strokes: 5, par: 5 }, { strokes: 3, par: 3 }]);
    expect(s.consecutiveBadHoles).toBe(0);
    expect(s.currentMentalState).toBe('confident');
  });
});
