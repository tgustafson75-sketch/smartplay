/**
 * 2026-10-15 (review G2, findings 3 / 4 / 8) — THE CADDIE-TAB MIC, DRIVEN FOR REAL.
 *
 * 4. A failed turn's line (local answer / saved note / verdict) waited up to 35s plus an internet
 *    check and was then spoken with no supersede check — over a NEWER live recording (iOS stops
 *    capturing) — and its 'idle' overwrote the new 'listening'. The success path already yielded.
 * 3. Shushing a reply that ended in "?" reopened the mic: the auto-listen saw the question and never
 *    learned the reply had been cut off.
 * 8. Every failed transcript was saved as an OFFLINE note and announced "I saved what you said", even
 *    when the failure was ours on a working connection; the note then reached the brain labelled
 *    "captured with no signal". Now only on a PROVEN offline verdict, in a line recorded in the
 *    caddie's own voice.
 */
const mockState = {
  epoch: 1,
  capturing: false,
  stopGen: 0,
  turn: null as null | { text: string; audioBase64: string | null; toolActions: unknown[] },
  verdict: 'internet_ok' as string,
  spoken: [] as string[],
  notices: [] as string[],
  onSpeak: null as null | (() => void),
};

jest.mock('react', () => ({ useRef: (v: unknown) => ({ current: v }), useCallback: (f: unknown) => f }));
jest.mock('../../services/caddieBrain', () => ({ askCaddie: jest.fn(async () => mockState.turn) }));
jest.mock('../../services/voiceService', () => ({
  speak: jest.fn(async (t: string) => { mockState.spoken.push(t); mockState.onSpeak?.(); }),
  speakFromBase64: jest.fn(async () => undefined),
  speakDeviceNotice: jest.fn(async (t: string) => { mockState.notices.push(t); }),
  isCapturing: () => mockState.capturing,
  isExternalMicActive: () => false,
  getStopGeneration: () => mockState.stopGen,
}));
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
jest.mock('../../services/caddieFailureReply', () => ({
  localAnswer: () => null,
  caddieFailureReply: jest.fn(async () => ({
    text: mockState.verdict === 'offline' ? "I can't get online right now — your yardages and score still work." : 'That one got away from me — say it again?',
    source: mockState.verdict === 'offline' ? 'offline' : 'on_us',
    verdict: mockState.verdict,
  })),
}));
const mockCapture = jest.fn((_t: string) => true);
jest.mock('../../services/voiceLogService', () => ({ captureOfflineStatement: (t: string) => mockCapture(t) }));

import { useCaddieTabMic } from '../../hooks/useCaddieTabMic';
// Loaded loosely so the pre-fix code fails on behaviour, not on a missing export.
const CADDIE_NOTICE_SAVED_OFFLINE = ((require('../../services/caddieAckLines') as Record<string, unknown>).CADDIE_NOTICE_SAVED_OFFLINE
  ?? { en: '(missing)', es: '(missing)', zh: '(missing)' }) as Record<'en' | 'es' | 'zh', string>;

jest.setTimeout(60_000);

function harness() {
  const states: string[] = [];
  const shown: string[] = [];
  const onReadyToListen = jest.fn();
  const onSuperseded = jest.fn();
  const mic = useCaddieTabMic({
    onKevinSpoke: (t) => shown.push(t),
    onVoiceStateChange: (s) => states.push(s),
    onReadyToListen,
    onSuperseded,
  });
  return { mic, states, shown, onReadyToListen, onSuperseded };
}

beforeEach(() => {
  Object.assign(mockState, { epoch: 1, capturing: false, stopGen: 0, turn: null, verdict: 'internet_ok', spoken: [], notices: [], onSpeak: null });
  mockCapture.mockClear();
});

describe('finding 4 — a late failure line yields to a newer live turn', () => {
  it('the player is recording again when the failure lands: caption only, no speech, no state', async () => {
    const h = harness();
    const askCaddie = (require('../../services/caddieBrain') as { askCaddie: jest.Mock }).askCaddie;
    askCaddie.mockImplementationOnce(async () => {
      // While the turn waited, the player started another one and the mic is live.
      mockState.epoch = 2;
      mockState.capturing = true;
      return null;
    });
    await h.mic.processTurn('what should I hit');
    expect(mockState.notices).toEqual([]);
    expect(mockState.spoken).toEqual([]);
    expect(h.states).not.toContain('speaking');
    expect(h.states).not.toContain('idle');
    expect(h.shown.length).toBe(1);
    expect(h.onSuperseded).toHaveBeenCalled();
  });
});

describe('finding 3 — a shushed question does not reopen the tab mic', () => {
  it('reply cut off mid-question → no auto-listen', async () => {
    const h = harness();
    mockState.turn = { text: 'Want the hole-by-hole?', audioBase64: null, toolActions: [] };
    mockState.onSpeak = () => { mockState.stopGen += 1; }; // the player tapped: stopSpeaking ran
    await h.mic.processTurn('how am I doing');
    expect(h.onReadyToListen).not.toHaveBeenCalled();
  });

  it('control: the same question heard to the end → listens for the answer', async () => {
    const h = harness();
    mockState.turn = { text: 'Want the hole-by-hole?', audioBase64: null, toolActions: [] };
    await h.mic.processTurn('how am I doing');
    expect(h.onReadyToListen).toHaveBeenCalledTimes(1);
  });
});

describe('finding 8 — "I saved what you said" only when the phone is proven offline', () => {
  it('our failure on a working connection: nothing saved as an offline note; the verdict line is said', async () => {
    mockState.verdict = 'internet_ok';
    const h = harness();
    await h.mic.processTurn('I am pulling everything left');
    expect(mockCapture).not.toHaveBeenCalled();
    expect(mockState.notices).toEqual(['That one got away from me — say it again?']);
  });

  it('proven offline: the words are kept and the caddie says so, in a recorded line', async () => {
    mockState.verdict = 'offline';
    const h = harness();
    await h.mic.processTurn('I am pulling everything left');
    expect(mockCapture).toHaveBeenCalledWith('I am pulling everything left');
    expect(mockState.notices).toEqual([CADDIE_NOTICE_SAVED_OFFLINE.en]);
    const { OFFLINE_LINES } = require('../../services/offlineVoiceCache') as typeof import('../../services/offlineVoiceCache');
    const recorded = new Set(OFFLINE_LINES.map((l) => l.text));
    for (const lang of ['en', 'es', 'zh'] as const) expect(recorded.has(CADDIE_NOTICE_SAVED_OFFLINE[lang])).toBe(true);
  });
});
