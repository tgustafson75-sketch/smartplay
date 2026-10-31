/**
 * 2026-10-31 (Brain recheck r22, BRAIN-AR-1) — A SCORE SAID WITH A QUESTION, OFFLINE, IS ON THE CARD, NOT ONLY IN A NOTE.
 *
 * "I got a 6, how far to the green?" on a proven-offline phone was kept as a free-text offline note, and nothing read the
 * note to write the score. The 6 reached the card only if the caddie spoke again later in the round and chose to log it.
 * Now the score is written through roundStore.logScore the moment it is kept, and the notice says the score is on the card.
 *
 * BEHAVIOURAL: the real caddieFailureReply, localIntentPrecheck, scoreParse and roundStore. Only the network verdict and
 * the voice-log capture are stubbed.
 */
const mockVerdict = { v: 'offline' as string };
const mockCapture = jest.fn((_t: string) => true);

jest.mock('../../services/reachability', () => ({
  ...jest.requireActual('../../services/reachability'),
  probeReachability: jest.fn(async () => ({ verdict: mockVerdict.v, at: Date.now() })),
}));
jest.mock('../../services/voiceLogService', () => ({ captureOfflineStatement: (t: string) => mockCapture(t) }));

import { keepScoreIfProvenOffline, localAnswer } from '../../services/caddieFailureReply';
import { CADDIE_NOTICE_SCORE_ON_CARD_OFFLINE } from '../../services/caddieAckLines';
import { useRoundStore } from '../../store/roundStore';

const SAID = 'I got a 6, how far to the green?';

function inRound(hole = 6) {
  useRoundStore.setState({ isRoundActive: true, currentRoundId: 'r-ar1', currentHole: hole, scores: {} } as never);
}

beforeEach(() => {
  mockVerdict.v = 'offline';
  mockCapture.mockClear();
  useRoundStore.setState({ isRoundActive: false, currentRoundId: null, scores: {} } as never);
});

describe('a score said with a question on a proven-offline phone is written to the card', () => {
  it('strokes[currentHole] is 6 and the answer says the score is on the card', async () => {
    inRound(6);
    expect(await keepScoreIfProvenOffline(SAID)).toBe('on_card');
    expect(useRoundStore.getState().scores[6]).toBe(6);
    expect(localAnswer(SAID, 'en', 'on_card')?.startsWith(CADDIE_NOTICE_SCORE_ON_CARD_OFFLINE.en)).toBe(true);
  });

  it('the written score is not also kept as a note the brain would re-read later', async () => {
    inRound(6);
    await keepScoreIfProvenOffline(SAID);
    expect(mockCapture).not.toHaveBeenCalled();
  });
});

describe('control: the same words without a usable round keep the words, and nothing is written', () => {
  it('no active round: the words are kept as a note and no score is written', async () => {
    expect(await keepScoreIfProvenOffline(SAID)).toBe('note');
    expect(mockCapture).toHaveBeenCalledWith(SAID);
    expect(Object.keys(useRoundStore.getState().scores)).toHaveLength(0);
  });

  it('online: nothing is kept and nothing is written', async () => {
    inRound(6);
    mockVerdict.v = 'internet_ok';
    expect(await keepScoreIfProvenOffline(SAID)).toBe(false);
    expect(useRoundStore.getState().scores[6]).toBeUndefined();
  });
});
