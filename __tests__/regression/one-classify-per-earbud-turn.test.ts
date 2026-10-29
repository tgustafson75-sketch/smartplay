/**
 * 2026-10-28 (voice engineering review, VOICE-ENG-2) — EVERY EARBUD TURN PAID FOR TWO CLASSIFIES.
 *
 * listeningSession's fetchWithTimeout raced the /api/voice-intent call against a "hedge" that slept
 * 2.5s and then POSTed the same utterance again — unconditionally. A healthy classify answers in well
 * under a second, so the hedge fired after the race was already won, nothing cancelled it, and the
 * turn was billed twice. Nor was either attempt tied to the turn: closing the session left the
 * classify running to its own 8–22s timer.
 *
 * It now races through services/voice/hedgedFetch.raceHedged (the transcribe paths' one owner) with
 * each attempt linked to the session's turnAbort. Driven through the real listeningSession turn; only
 * the network, the mic and the brain are stubbed.
 */
type Capture = { text: string | null; bail: string | null; heardSpeech: boolean; durationMs: number | null };

const mockState = {
  captures: [] as Capture[],
};

jest.mock('../../services/voiceService', () => ({
  speak: jest.fn(async () => undefined),
  speakFromBase64: jest.fn(async () => undefined),
  stopSpeaking: jest.fn(async () => undefined),
  captureUtteranceDetailed: jest.fn(async () => mockState.captures.shift() ?? { text: null, bail: 'cancelled', heardSpeech: false, durationMs: 0 }),
  releaseExternalMic: jest.fn(async () => 'none'),
  playLocalFile: jest.fn(async () => undefined),
  stopCapture: jest.fn(async () => undefined),
  endCaptureEarly: jest.fn(),
  flashCaption: jest.fn(),
  getLastSpokenLine: jest.fn(() => null),
  isCapturing: jest.fn(() => false),
  isExternalMicActive: jest.fn(() => false),
  speakDeviceNotice: jest.fn(async () => undefined),
  isSpeaking: jest.fn(() => false),
  isSpeakingUserInitiated: jest.fn(() => false),
  getCaptionSeq: jest.fn(() => 0),
  activeVoice: jest.fn(() => ({ persona: 'kevin', gender: 'male' })),
}));
jest.mock('../../services/voiceErrorLog', () => ({
  logVoiceSilentFail: jest.fn(), logVoiceDiag: jest.fn(), describeError: (e: unknown) => String(e),
}));
jest.mock('../../services/voice/turnAnswerWatch', () => ({
  noteTurnState: jest.fn(), noteTurnIntent: jest.fn(), noteTurnClosing: jest.fn(), noteTurnActed: jest.fn(),
}));
jest.mock('../../services/conversationalBrain', () => ({
  conversationalBrainTurn: jest.fn(async () => ({ text: null, audioBase64: null, toolActions: [] })),
}));
jest.mock('../../services/caddieBrain', () => ({ askCaddie: jest.fn(async () => null) }));
jest.mock('../../services/appForeground', () => ({
  settleForegroundForMic: jest.fn(async () => 'active'), micMayBeRefusedNow: jest.fn(() => false),
}));
jest.mock('../../services/voiceWarmup', () => ({ abortVoiceWarmup: jest.fn() }));
jest.mock('../../services/userTurnClock', () => ({ noteUserTurn: jest.fn(), getUserTurnEpoch: jest.fn(() => 1) }));
jest.mock('../../services/funnelEvents', () => ({ noteCaddieTurn: jest.fn() }));
jest.mock('../../services/featureAccess', () => ({ takeCaddiePaywallBlock: jest.fn(() => null), CADDIE_PAYWALL_DEFERRED_LINE: 'deferred' }));
jest.mock('../../services/dialogEngine', () => ({ getDialog: jest.fn(() => 'Go ahead.') }));
jest.mock('../../services/trustLevelService', () => ({ getTrustLevel: jest.fn(() => 2) }));
jest.mock('../../store/roundStore', () => ({
  useRoundStore: { getState: () => ({
    isRoundActive: false, activeCourse: null, mode: 'stroke', currentHole: 1, shots: [],
    getHolesPlayed: () => 0, getTotalScore: () => 0, getScoreVsPar: () => 0,
  }) },
}));
jest.mock('../../store/settingsStore', () => ({
  useSettingsStore: { getState: () => ({
    voiceEnabled: true, language: 'en', voiceGender: 'male', aiProvider: 'gemini',
    caddiePersonality: 'kevin', autoListenEnabled: false,
    caddieAssignments: { round: 'kevin', practice: 'kevin', drills: 'kevin', play: 'kevin' },
  }) },
}));
jest.mock('../../services/intents', () => ({ voiceCommandRouter: { getHandler: jest.fn(() => null) } }));
jest.mock('../../services/earbudControl', () => ({ subscribeEarbudTap: jest.fn(() => () => undefined) }));
jest.mock('../../services/smartMotionRecordBus', () => ({ isSmartMotionRecording: jest.fn(() => false), emitSmartMotionCommand: jest.fn() }));
jest.mock('../../services/responseRouter', () => ({ routeQuery: jest.fn(() => ({ filler: null })) }));
jest.mock('../../services/activeSurfaceRegistry', () => ({ getActiveSurface: jest.fn(() => 'caddie') }));
jest.mock('../../services/localIntentPrecheck', () => ({ precheckLocalIntent: jest.fn(() => null) }));
jest.mock('../../services/pendingDisambiguation', () => ({ resolvePendingCourseUtterance: jest.fn(() => null) }));
jest.mock('../../store/voiceHitRateStore', () => ({ useVoiceHitRateStore: { getState: () => ({ recordLocal: jest.fn(), recordCloud: jest.fn() }) } }));
jest.mock('../../services/apiBase', () => ({
  getApiBaseUrl: () => 'http://localhost:9', isEndpointWarmed: () => true, markEndpointWarmed: jest.fn(),
}));
jest.mock('../../services/pendingPuttAsk', () => ({ tryAnswerOpenQuestion: jest.fn(() => null) }));
jest.mock('../../store/flagStore', () => ({ isFlagEnabled: jest.fn(() => true) }));
jest.mock('../../services/adviceFreshness', () => ({
  adviceIsStillWorthSaying: jest.fn(() => true), captureShotEpoch: jest.fn(() => null), currentTurnEpoch: jest.fn(() => null),
}));
jest.mock('../../services/caddieFailureReply', () => ({
  failureNotice: jest.fn(async () => 'x'), failureNoticeSync: jest.fn(() => 'x'), localAnswer: jest.fn(() => null),
}));
jest.mock('../../store/listeningSessionStore', () => ({ useListeningSessionStore: { getState: () => ({ setState: jest.fn() }) } }));
jest.mock('../../services/offlineVoiceCache', () => ({ resolveCachedOfflineClipUri: jest.fn(() => null) }));
jest.mock('../../services/voice/conversationalToolDispatch', () => ({ dispatchConversationalToolActions: jest.fn() }));

type LS = typeof import('../../services/listeningSession');
jest.setTimeout(120_000);

/** One /api/voice-intent attempt as the network saw it. */
type Call = { signal: AbortSignal; answer: () => void };
let classifies: Call[] = [];
/** How the network answers a classify: after `ms`, or never (a hung socket — only an abort ends it). */
let answerAfterMs: number | null = 300;

const okIntent = () => ({ ok: true, status: 200, json: async () => ({ intent_type: 'conversational', confidence: 'high' }) });

let ls: LS;
const flush = async (n = 20) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const advance = async (ms: number) => { await jest.advanceTimersByTimeAsync(ms); await flush(); };

beforeEach(() => {
  jest.resetModules();
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  jest.setSystemTime(10_000_000);
  classifies = [];
  answerAfterMs = 300;
  mockState.captures = [{ text: 'should I lay up here', bail: null, heardSpeech: true, durationMs: 1500 }];
  (globalThis as { fetch?: unknown }).fetch = jest.fn((url: string, init: { signal: AbortSignal }) => {
    if (!String(url).includes('/api/voice-intent')) return Promise.reject(new Error('offline in test'));
    return new Promise((resolve, reject) => {
      const call: Call = { signal: init.signal, answer: () => resolve(okIntent()) };
      classifies.push(call);
      init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      if (answerAfterMs != null) setTimeout(call.answer, answerAfterMs);
    });
  });
  ls = require('../../services/listeningSession') as LS;
});
afterEach(() => { ls.forceCloseSession(); jest.useRealTimers(); });

async function startTurn(): Promise<void> {
  void ls.toggle();
  await flush();
  await advance(50);
}

describe('one earbud turn is one paid classify', () => {
  it('a healthy classify (answers in 300 ms) is the only one — the hedge never opens', async () => {
    await startTurn();
    await advance(10_000); // well past the 2.5s hedge and both budgets
    expect(classifies).toHaveLength(1);
  });

  it('a hung first socket gets ONE hedge at 2.5s, and the losing first socket is aborted', async () => {
    answerAfterMs = null;
    await startTurn();
    expect(classifies).toHaveLength(1);
    await advance(2_600);
    expect(classifies).toHaveLength(2);
    classifies[1].answer();
    await advance(10);
    expect(classifies[0].signal.aborted).toBe(true);   // the loser stops, not left to bill on
    expect(classifies[1].signal.aborted).toBe(false);  // the winner's body is still being read
    await advance(30_000);
    expect(classifies).toHaveLength(2);
  });

  it('closing the session mid-classify aborts it at once, not at its own 8s timer', async () => {
    answerAfterMs = null;
    await startTurn();
    expect(classifies).toHaveLength(1);
    await advance(500);
    ls.forceCloseSession();
    await advance(10);
    expect(classifies[0].signal.aborted).toBe(true);
    await advance(5_000);
    expect(classifies).toHaveLength(1); // and no hedge is opened for a turn that no longer exists
  });
});
