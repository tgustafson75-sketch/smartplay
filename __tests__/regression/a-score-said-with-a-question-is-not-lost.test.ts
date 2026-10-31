/**
 * 2026-10-31 (Brain recheck r19, BRAIN-B) — A SCORE SAID WITH A QUESTION IS NOT SILENTLY DROPPED.
 *
 * r17 (BRAIN-7) sends "I got a 4, how far is the water" to the brain only, so the score is written by the
 * brain's own log_score tool. When the brain fails, the failure owner answers the question and never
 * writes the score, so the 4 vanished and the reply was a yardage. The failure reply now says the score
 * was not logged, so he says it again instead of trusting a card that is missing it.
 *
 * NEAR_MISS_RX also matched the common "close to", so "I made a 3, close to the pin" was blocked from
 * the card. A near miss now needs a score word after it ("almost birdied"), not any "close to".
 *
 * BEHAVIOURAL: the real precheckLocalIntent, scoreSaidButNotLogged and localAnswer.
 */
const mockFix = { fix: null as null | { lat: number; lng: number; accuracy_m: number; timestamp: number } };
jest.mock('../../services/gpsManager', () => ({ getLastFix: () => mockFix.fix }));
jest.mock('../../services/smartFinderService', () => ({
  resolveGreenCoords: () => ({
    front: { lat: 33.0008, lng: -117.0 },
    middle: { lat: 33.0, lng: -117.0 },
    back: { lat: 32.9992, lng: -117.0 },
  }),
  classifyAccuracy: () => ({ level: 'good' }),
  holeData: () => null,
}));

import { precheckLocalIntent, scoreSaidButNotLogged } from '../../services/localIntentPrecheck';
import { localAnswer } from '../../services/caddieFailureReply';
import { useRoundStore } from '../../store/roundStore';

beforeEach(() => {
  mockFix.fix = { lat: 33.0 - 0.0014, lng: -117.0, accuracy_m: 5, timestamp: Date.now() };
  useRoundStore.setState({ isRoundActive: true, currentHole: 12, activeCourseId: 'hemet-test' });
});

describe('the score half of a question is reported as not logged on the offline route', () => {
  it.each(['I got a 4, how far is the water', "I got a 5 and I hit it in the water, what's my play"])(
    '"%s" → the score is flagged as not logged',
    (said) => {
      expect(scoreSaidButNotLogged(said)).toBe(true);
    },
  );

  it('the failure reply says the score did not go down, with the answer after it', () => {
    expect(localAnswer('I got a 4, how far is the water', 'en')).toMatch(/didn't get your score down/);
  });

  it('a plain score, a near miss and a question with no score are not flagged', () => {
    expect(scoreSaidButNotLogged('I got a 4')).toBe(false);
    expect(scoreSaidButNotLogged('I almost birdied that hole')).toBe(false);
    expect(scoreSaidButNotLogged('how far is the water')).toBe(false);
  });
});

describe('"close to" is not a near miss unless a score word follows it', () => {
  it.each(['I made a 4, close to the green', 'I made a 3, close to the hole', 'I got a 4, it was close to the water'])(
    '"%s" → log_score',
    (said) => {
      expect(precheckLocalIntent(said)?.intent_type).toBe('log_score');
    },
  );

  it.each(['I was so close to a birdie on that one', 'I came close to a par'])(
    '"%s" is still narration, not log_score',
    (said) => {
      expect(precheckLocalIntent(said)?.intent_type).not.toBe('log_score');
    },
  );
});
