/**
 * 2026-10-31 (Brain recheck r23, BRAIN-PLAYER-1) — A SCORE SAID FOR A NAMED HOLE, OFFLINE, IS WRITTEN TO THAT HOLE.
 *
 * "I got a 6 on the 12th, how far to the green?" on a proven-offline phone stood on hole 13 was written to hole 13:
 * writeScoreOffline read the current hole and never parsed the hole the player named, so the 6 overwrote a real score
 * on 13 and hole 12 stayed blank. The reply then said the score was on the card. The named hole is the one written,
 * the current hole's score is left alone, and a hole the words name that is not on the card is kept as a note.
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

const SAID = 'I got a 6 on the 12th, how far to the green?';

beforeEach(() => {
  mockVerdict.v = 'offline';
  mockCapture.mockClear();
  useRoundStore.setState({
    isRoundActive: true,
    currentRoundId: 'r-ar23',
    currentHole: 13,
    scores: { 13: 4 },
  } as never);
});

describe('a score said for a named hole on a proven-offline phone is written to that hole', () => {
  it('the named hole gets the score, and the hole he stands on keeps its own', async () => {
    expect(await keepScoreIfProvenOffline(SAID)).toBe('on_card');
    expect(useRoundStore.getState().scores[12]).toBe(6);
    expect(useRoundStore.getState().scores[13]).toBe(4);
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it('a named hole that is not on the card is refused, kept as a note, and nothing is written', async () => {
    expect(await keepScoreIfProvenOffline('I got a 6 on the 19th, how far to the green?')).toBe('note');
    expect(mockCapture).toHaveBeenCalled();
    expect(useRoundStore.getState().scores[13]).toBe(4);
    expect(useRoundStore.getState().scores[12]).toBeUndefined();
    expect(useRoundStore.getState().scores[19]).toBeUndefined();
  });
});

describe('control: a score said with no hole named still goes to the hole he stands on', () => {
  it('no hole named: the current hole is written', async () => {
    useRoundStore.setState({ scores: {} } as never);
    expect(await keepScoreIfProvenOffline('I got a 6, how far to the green?')).toBe('on_card');
    expect(useRoundStore.getState().scores[13]).toBe(6);
  });
});
