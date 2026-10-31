/**
 * 2026-10-31 (Brain recheck r23, BRAIN-PLAYER-3) — A DISTANCE TO A NAMED HOLE IS NOT THE CURRENT HOLE'S GREEN.
 *
 * Phone proven offline, standing on 13: "how far to the green on the 12th" was answered with 13's green yardage. The
 * precheck sends a named-hole distance to the brain, but the offline failure owner's yardage branch had no hole-scope
 * check and yardageReply reads the current hole only. The branch now declines a named hole, so the failure owner's
 * honest line is spoken instead of a confident wrong number.
 *
 * BEHAVIOURAL: the real tryLocalReply on a live round with a known green and a fresh fix.
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
  useRoundStore.setState({ isRoundActive: true, currentHole: 13, activeCourseId: 'hemet-test' });
});

describe('a named-hole distance is declined offline, so the honest line is spoken', () => {
  it.each([
    'how far to the green on the 12th',
    'how far to the back on 12',
    'how far to the front on hole 12',
  ])('"%s" → declined (null), never the current hole\'s yardage', (said) => {
    expect(tryLocalReply(said, 'en')).toBeNull();
  });
});

describe('control: the current hole\'s green distances keep their instant local answer', () => {
  it.each([
    ['how far to the pin', 'yardage_middle'],
    ['how far to the back', 'yardage_back'],
  ])('"%s" → %s', (said, queryType) => {
    expect(tryLocalReply(said, 'en')?.queryType).toBe(queryType);
  });
});
