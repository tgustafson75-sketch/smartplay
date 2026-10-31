/**
 * 2026-10-31 (Brain recheck r20, BRAIN-R20-2) — "WHAT'S MY SCORE ON THIS HOLE" OFFLINE IS NOT THE ROUND TOTAL.
 *
 * The brain-bound precheck declined a deictic or named-hole score (BRAIN-4, r15). The offline answer
 * (tryLocalReply, reached after a failed brain turn) had no such gate, so RX.score matched "my score" and
 * scoreReply summed every scored hole: "you're 4 over through 9" was the answer about one hole.
 *
 * BEHAVIOURAL: the real localStatusResponder.tryLocalReply and the real precheck gate.
 */
jest.mock('../../services/gpsManager', () => ({ getLastFix: () => null }));
jest.mock('../../services/smartFinderService', () => ({
  resolveGreenCoords: () => null,
  classifyAccuracy: () => ({ level: 'good' }),
  holeData: (h: number) => ({ par: h === 5 ? 3 : 4 }),
}));

import { tryLocalReply } from '../../services/localStatusResponder';
import { holeScopedAsk } from '../../services/localIntentPrecheck';
import { useRoundStore } from '../../store/roundStore';

beforeEach(() => {
  useRoundStore.setState({
    isRoundActive: true,
    currentHole: 5,
    activeCourseId: 'test-course',
    scores: { 1: 5, 2: 4, 3: 4, 4: 5 },
  } as never);
});

describe('a score asked about ONE hole is not answered with the round', () => {
  it.each([
    "what's my score on this hole",
    "what's my score on that one",
    "what's my score on hole 3",
  ])('"%s" is declined offline, so the honest line is spoken', (said) => {
    expect(tryLocalReply(said, 'en')).toBeNull();
  });

  it('the precheck gate names the same asks', () => {
    expect(holeScopedAsk("what's my score on this hole", 'score')).toBe(true);
    expect(holeScopedAsk("what's my score on hole 3", 'score')).toBe(true);
    expect(holeScopedAsk("what's my score", 'score')).toBe(false);
  });

  it('control: the round score is still answered, from the same card', () => {
    expect(tryLocalReply("what's my score", 'en')?.text).toBeTruthy();
  });
});
