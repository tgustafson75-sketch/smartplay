/**
 * 2026-10-31 (Brain recheck r27, BRAIN-AR-R27-1) — A SPOKEN HOLE ON A TWICE-AROUND ROUND IS MAPPED OFFLINE AS ONLINE.
 *
 * Standing on round hole 12 of a nine played twice, offline, "I got a 5 on the third" was written to the FRONT-nine hole 3:
 * writeScoreOffline took the spoken number literally, so the 5 overwrote his real score on 3 and hole 12 stayed blank. The
 * online writer (logScoreHandler) maps the same words through roundHoleForSpoken, so the two paths disagreed. The spoken
 * hole is now mapped the same way, and the par is read for the hole that is written.
 *
 * BEHAVIOURAL: the real caddieFailureReply, localIntentPrecheck, spokenHole, scoreParse and roundStore. Only the
 * network verdict and the voice-log capture are stubbed.
 */
const mockVerdict = { v: 'offline' as string };
const mockCapture = jest.fn((_t: string) => true);

jest.mock('../../services/reachability', () => ({
  ...jest.requireActual('../../services/reachability'),
  probeReachability: jest.fn(async () => ({ verdict: mockVerdict.v, at: Date.now() })),
}));
jest.mock('../../services/voiceLogService', () => ({ captureOfflineStatement: (t: string) => mockCapture(t) }));

import { keepScoreIfProvenOffline } from '../../services/caddieFailureReply';
import { useRoundStore } from '../../store/roundStore';

const SAID = 'I got a 5 on the third, how far to the water?';

beforeEach(() => {
  mockVerdict.v = 'offline';
  mockCapture.mockClear();
  useRoundStore.setState({
    isRoundActive: true,
    currentRoundId: 'r-ar27',
    twiceAround: true,
    currentHole: 12,
    scores: { 3: 4, 11: 5 },
  } as never);
});

describe('a spoken hole on a twice-around round is written to the round hole, offline as online', () => {
  it('"the third" on round hole 12 writes hole 12 and leaves the front-nine hole 3 alone', async () => {
    expect(await keepScoreIfProvenOffline(SAID)).toBe('on_card');
    expect(useRoundStore.getState().scores[12]).toBe(5);
    expect(useRoundStore.getState().scores[3]).toBe(4);
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it('a first-loop spoken hole still names the front nine when the round is not twice around', async () => {
    useRoundStore.setState({ twiceAround: false, currentHole: 12, scores: { 3: 4 } } as never);
    expect(await keepScoreIfProvenOffline(SAID)).toBe('on_card');
    expect(useRoundStore.getState().scores[3]).toBe(5);
    expect(useRoundStore.getState().scores[12]).toBeUndefined();
  });
});
