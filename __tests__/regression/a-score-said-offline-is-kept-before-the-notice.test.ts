/**
 * 2026-10-31 (Brain recheck r20, BRAIN-R20-1) — A SCORE SAID WITH A QUESTION IS KEPT WHEN THE PHONE IS PROVEN OFFLINE.
 *
 * localAnswer returned the "didn't get your score down — say it again" notice for "I got a 5, what's my play", and
 * the caddie-tab mic returned on it, so captureOfflineStatement never ran: the 5 was lost while he was offline and
 * he was told to repeat it. Now the words are kept first (keepScoreIfProvenOffline) and the saved-offline line leads.
 *
 * BEHAVIOURAL: the real caddieFailureReply, localIntentPrecheck and useCaddieTabMic; only the network verdict and
 * the voice-log store are stubbed.
 */
const mockVerdict = { v: 'offline' as string };
const mockCapture = jest.fn((_t: string) => true);
const mockState = {
  epoch: 1,
  capturing: false,
  stopGen: 0,
  turn: null as null | { text: string; audioBase64: string | null; toolActions: unknown[] },
  spoken: [] as string[],
  notices: [] as string[],
};

jest.mock('react', () => ({ useRef: (v: unknown) => ({ current: v }), useCallback: (f: unknown) => f }));
jest.mock('../../services/gpsManager', () => ({ getLastFix: () => null }));
jest.mock('../../services/smartFinderService', () => ({
  resolveGreenCoords: () => null,
  classifyAccuracy: () => ({ level: 'good' }),
  holeData: () => null,
}));
jest.mock('../../services/reachability', () => ({
  ...jest.requireActual('../../services/reachability'),
  probeReachability: jest.fn(async () => ({ verdict: mockVerdict.v, at: Date.now() })),
}));
jest.mock('../../services/voiceLogService', () => ({ captureOfflineStatement: (t: string) => mockCapture(t) }));
jest.mock('../../services/caddieBrain', () => ({ askCaddie: jest.fn(async () => mockState.turn) }));
jest.mock('../../services/voiceService', () => ({
  speak: jest.fn(async (t: string) => { mockState.spoken.push(t); }),
  speakFromBase64: jest.fn(async () => undefined),
  speakDeviceNotice: jest.fn(async (t: string) => { mockState.notices.push(t); }),
  isCapturing: () => mockState.capturing,
  isExternalMicActive: () => false,
  getStopGeneration: () => mockState.stopGen,
}));
jest.mock('../../services/intents', () => ({ voiceCommandRouter: { getHandler: jest.fn(() => null) } }));
jest.mock('../../hooks/useVoiceCaddie', () => ({
  endsAsQuestion: (t: string) => /\?\s*$/.test(t),
  isCloseIntent: () => false,
}));
jest.mock('../../store/settingsStore', () => ({
  useSettingsStore: { getState: () => ({ voiceEnabled: true, language: 'en', voiceGender: 'male', continuousConversationMode: false }) },
}));
jest.mock('../../services/conversationState', () => ({ recordKevinTurn: jest.fn() }));
jest.mock('../../services/apiBase', () => ({ getApiBaseUrl: () => 'http://localhost:9', markEndpointWarmed: jest.fn(), isEndpointWarmed: () => true }));
jest.mock('../../services/devLog', () => ({ devLog: jest.fn() }));
jest.mock('../../services/featureAccess', () => ({ takeCaddiePaywallBlock: () => null, CADDIE_PAYWALL_DEFERRED_LINE: 'deferred' }));
jest.mock('../../services/userTurnClock', () => ({ noteUserTurn: jest.fn(), getUserTurnEpoch: () => mockState.epoch }));
jest.mock('../../services/funnelEvents', () => ({ noteCaddieTurn: jest.fn() }));
jest.mock('../../services/voiceWarmup', () => ({ abortVoiceWarmup: jest.fn() }));
jest.mock('../../services/voice/conversationHistory', () => ({ clearConversationHistory: jest.fn() }));
jest.mock('../../store/conversationLogStore', () => ({ useConversationLog: { getState: () => ({ logUser: jest.fn() }) } }));
jest.mock('../../services/voice/turnAnswerWatch', () => ({ createTurnWatch: () => ({ state: jest.fn(), acted: jest.fn() }) }));
jest.mock('../../services/pendingPuttAsk', () => ({ tryAnswerOpenQuestion: () => null }));
jest.mock('../../store/issueLogStore', () => ({ useIssueLogStore: { getState: () => ({ addVoiceTurn: jest.fn(), addAppEvent: jest.fn() }) } }));
jest.mock('../../store/pointsStore', () => ({ usePointsStore: { getState: () => ({ addPoints: jest.fn() }) } }));

import { useCaddieTabMic } from '../../hooks/useCaddieTabMic';
import { keepScoreIfProvenOffline, localAnswer } from '../../services/caddieFailureReply';
import { CADDIE_NOTICE_SAVED_OFFLINE, CADDIE_NOTICE_SCORE_NOT_LOGGED } from '../../services/caddieAckLines';

const SAID = 'I got a 5, what\'s my play';

beforeEach(() => {
  Object.assign(mockState, { epoch: 1, capturing: false, stopGen: 0, turn: null, spoken: [], notices: [] });
  mockVerdict.v = 'offline';
  mockCapture.mockClear();
});

function useTabHarness() {
  return useCaddieTabMic({ onKevinSpoke: () => undefined, onVoiceStateChange: () => undefined, onReadyToListen: jest.fn(), onSuperseded: jest.fn() });
}

describe('a score said with a question, on a proven-offline phone, is kept', () => {
  it('the owner keeps the words and the saved line leads the answer', async () => {
    // 2026-10-31 (Brain recheck r22, BRAIN-AR-1) — no round is active here, so the score cannot reach the card and the words
    // are kept as a note ('note'). With a round the score is written and the answer is 'on_card' (a-score-said-offline-is-written-to-the-card).
    expect(await keepScoreIfProvenOffline(SAID)).toBe('note');
    expect(mockCapture).toHaveBeenCalledWith(SAID);
    expect(localAnswer(SAID, 'en', 'note')?.startsWith(CADDIE_NOTICE_SAVED_OFFLINE.en)).toBe(true);
  });

  it('the caddie tab captures the score and speaks the saved line, not the "say it again" notice', async () => {
    await useTabHarness().processTurn(SAID);
    expect(mockCapture).toHaveBeenCalledWith(SAID);
    expect(mockState.spoken[0].startsWith(CADDIE_NOTICE_SAVED_OFFLINE.en)).toBe(true);
    expect(mockState.spoken.join(' ')).not.toContain(CADDIE_NOTICE_SCORE_NOT_LOGGED.en);
  });
});

describe('control: the same words on a phone that is online are not kept, and the notice says what is true', () => {
  it('nothing is captured and the score-not-logged notice is spoken', async () => {
    mockVerdict.v = 'internet_ok';
    expect(await keepScoreIfProvenOffline(SAID)).toBe(false);
    await useTabHarness().processTurn(SAID);
    expect(mockCapture).not.toHaveBeenCalled();
    expect(mockState.spoken.join(' ')).toContain(CADDIE_NOTICE_SCORE_NOT_LOGGED.en);
  });

  it('a question with no score is never probed or kept, offline or not', async () => {
    expect(await keepScoreIfProvenOffline('how far is the water')).toBe(false);
    expect(mockCapture).not.toHaveBeenCalled();
  });
});
