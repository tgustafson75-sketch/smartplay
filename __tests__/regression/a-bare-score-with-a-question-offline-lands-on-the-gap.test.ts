/**
 * 2026-10-31 (Brain recheck r26, BRAIN-R26-1) — A BARE SCORE SAID WITH A QUESTION, OFFLINE, LANDS ON THE UNSCORED GAP.
 *
 * "I got a 5, how far to the water?" on a proven-offline phone with hole 5 unscored and GPS already on 6 (the tee) was
 * written by writeScoreOffline to the NAV hole: the 5 overwrote hole 6 and hole 5 stayed blank for good. A bare score
 * now takes the same hole as logScoreHandler (voiceScoreHole): the lowest unscored hole in the run that ends at the
 * current hole.
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

const SAID = 'I got a 5, how far to the water?';

beforeEach(() => {
  mockVerdict.v = 'offline';
  mockCapture.mockClear();
  useRoundStore.setState({
    isRoundActive: true,
    currentRoundId: 'r-ar26',
    currentHole: 6,
    scores: { 1: 4, 2: 5, 3: 4, 4: 6 },
  } as never);
});

describe('a bare score said with a question, offline, lands on the unscored gap behind the current hole', () => {
  it('hole 5 (unscored, behind GPS on 6) gets the 5, and hole 6 is not overwritten', async () => {
    expect(await keepScoreIfProvenOffline(SAID)).toBe('on_card');
    expect(useRoundStore.getState().scores[5]).toBe(5);
    expect(useRoundStore.getState().scores[6]).toBeUndefined();
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it('control: when the current hole is the only gap, the score still lands on it', async () => {
    useRoundStore.setState({ scores: { 1: 4, 2: 5, 3: 4, 4: 6, 5: 5 } } as never);
    expect(await keepScoreIfProvenOffline('I got a 6, how far to the water?')).toBe('on_card');
    expect(useRoundStore.getState().scores[6]).toBe(6);
  });
});
