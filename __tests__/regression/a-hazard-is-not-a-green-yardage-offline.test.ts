/**
 * 2026-10-31 (Brain recheck r19, BRAIN-A) — "HOW FAR TO THE WATER" OFFLINE IS NOT THE GREEN YARDAGE.
 *
 * The BRAIN-1 fix (r18) taught localIntentPrecheck that a hazard distance is a question. The failure
 * owner never reads that precheck: when the brain fails, caddieFailureReply.localAnswer runs
 * answerOffline → tryLocalReply, and RX.yardage matched "how far" and returned the green middle. A
 * creek in play was answered with "152 to the middle" — a confident number to the wrong question.
 *
 * BEHAVIOURAL: the real tryLocalReply and answerOffline on a live round with a known green and a fresh
 * fix. A hazard question must decline (null, so the failure owner gives the honest line); the plain
 * green distance keeps its instant answer.
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

import { tryLocalReply } from '../../services/localStatusResponder';
import { answerOffline } from '../../services/offlineCaddie';
import { useRoundStore } from '../../store/roundStore';

beforeEach(() => {
  mockFix.fix = { lat: 33.0 - 0.0014, lng: -117.0, accuracy_m: 5, timestamp: Date.now() };
  useRoundStore.setState({ isRoundActive: true, currentHole: 12, activeCourseId: 'hemet-test' });
});

describe('a hazard distance is not answered with the green yardage when the brain is down', () => {
  it.each([
    'how far to the water',
    'how far is it to the trees',
    'how far to clear the creek',
    'how far to carry the bunker',
  ])('"%s" → declined (null), never a green yardage', (said) => {
    expect(tryLocalReply(said, 'en')).toBeNull();
  });

  it('answerOffline does not answer a hazard distance with a yardage', () => {
    expect(answerOffline('how far to the water', 'en')?.detail ?? '').not.toMatch(/^yardage/);
  });
});

describe('the plain green distances keep their instant local answer', () => {
  it.each([
    ['how far to the pin', 'yardage_middle'],
    ['how far to the front', 'yardage_front'],
    ['how far to the back', 'yardage_back'],
  ])('"%s" → %s', (said, queryType) => {
    expect(tryLocalReply(said, 'en')?.queryType).toBe(queryType);
  });
});
