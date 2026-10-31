/**
 * 2026-10-31 (Brain recheck r21, BRAIN-R21-4) — "WHAT CLUB DO I HIT TO CARRY THE WATER" OFFLINE IS NOT THE GREEN CLUB.
 *
 * BRAIN-R19-A declined a hazard distance on the yardage branch of the offline reader, but the club branch
 * (RX.clubRec) had no hazard test. The failure owner reads this reader when the brain has failed, so "what club
 * do I hit to carry the water" was answered with the club for the green middle, and the carry was never considered.
 *
 * BEHAVIOURAL: the real tryLocalReply on a live round with a known green and a fresh fix. A hazard club question
 * must decline (null, so the failure owner gives the honest line); the plain club question keeps its answer.
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
import { useRoundStore } from '../../store/roundStore';

beforeEach(() => {
  mockFix.fix = { lat: 33.0 - 0.0014, lng: -117.0, accuracy_m: 5, timestamp: Date.now() };
  useRoundStore.setState({ isRoundActive: true, currentHole: 12, activeCourseId: 'hemet-test' });
});

describe('a club question about a hazard is not answered with the green club when the brain is down', () => {
  it.each([
    'what club do I hit to carry the water',
    'what club should I hit to clear the creek',
    'what club do I need to carry the bunker',
    'what club do I hit over the trees',
  ])('"%s" → declined (null), never a green-middle club', (said) => {
    expect(tryLocalReply(said, 'en')).toBeNull();
  });

  it('a plain club question keeps its local answer', () => {
    expect(tryLocalReply('what club should I hit here', 'en')?.queryType).toBe('club_recommend');
  });
});
