/**
 * 2026-10-28 (Brain review r3) — THE EARBUD "WHY AM I SLICING IT" IS THE DIAGNOSTIC HANDLER'S TOO.
 *
 * services/listeningSession had its own in_round_diagnostic branch that returned before dispatch ever
 * ran inRoundDiagnosticHandler. It asked the brain the classifier's SUMMARY ("swing today") with no
 * `heard`, no live vision block, no evidence-order doctrine and no offline evidence gate — and since
 * `heard` defaults to the message, it filed "swing today" in the shared history and the style learner
 * as the player's words. b16a169f fixed exactly that in the handler; the earbud twin kept it.
 *
 * Drives the REAL earbud session through the REAL router and handler; the brain is stubbed at
 * askCaddie so the payload each route sends can be compared.
 */

type Capture = { text: string | null; bail: string | null; heardSpeech: boolean; durationMs: number | null };

const mockState = {
  captures: [] as Capture[],
  spoken: [] as string[],
  brainMessages: [] as string[],
  searches: [] as string[],
  pushes: 0,
  routes: [] as unknown[],
  asks: [] as Array<Record<string, unknown>>,
  precheck: null as unknown,
  language: 'en' as 'en' | 'es',
};
const noCapture: Capture = { text: null, bail: 'cancelled', heardSpeech: false, durationMs: 0 };

jest.mock('../../services/songPortal', () => ({ searchSong: jest.fn(async () => null) }));
jest.mock('expo-router', () => ({ router: { push: jest.fn((to: unknown) => { mockState.pushes += 1; mockState.routes.push(to); }) } }));
jest.mock('../../services/unifiedVisionContext', () => ({ getUnifiedVisionContext: jest.fn(async () => ({ promptBlock: 'LIVE VISION: ball in light rough' })) }));
jest.mock('../../services/localIntentPrecheck', () => ({ precheckLocalIntent: jest.fn(() => mockState.precheck) }));
jest.mock('../../services/voiceService', () => ({
  speak: jest.fn(async (text: string) => { mockState.spoken.push(text); }),
  speakFromBase64: jest.fn(async (_b: string, o?: { caption?: string }) => { mockState.spoken.push(o?.caption ?? '(audio)'); }),
  stopSpeaking: jest.fn(async () => undefined),
  captureUtteranceDetailed: jest.fn(async () => mockState.captures.shift() ?? noCapture),
  releaseExternalMic: jest.fn(async () => 'none'),
  playLocalFile: jest.fn(async () => undefined),
  stopCapture: jest.fn(async () => undefined),
  endCaptureEarly: jest.fn(),
  flashCaption: jest.fn(),
  getLastSpokenLine: jest.fn(() => null),
  isCapturing: jest.fn(() => false),
  isExternalMicActive: jest.fn(() => false),
  speakDeviceNotice: jest.fn(async (t: string) => { mockState.spoken.push(t); }),
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
  conversationalBrainTurn: jest.fn(async (message: string) => {
    mockState.brainMessages.push(message);
    return { text: 'Smooth 7.', audioBase64: null, toolActions: [] };
  }),
}));
jest.mock('../../services/caddieBrain', () => ({
  askCaddie: jest.fn(async (opts: Record<string, unknown>) => {
    mockState.asks.push(opts);
    return { text: 'Face is open to the path — strengthen the grip a touch.', audioBase64: null, toolActions: [] };
  }),
}));
jest.mock('../../services/voiceWarmup', () => ({ abortVoiceWarmup: jest.fn() }));
jest.mock('../../services/userTurnClock', () => ({ noteUserTurn: jest.fn(), getUserTurnEpoch: jest.fn(() => 1) }));
jest.mock('../../services/funnelEvents', () => ({ noteCaddieTurn: jest.fn() }));
jest.mock('../../services/featureAccess', () => ({ takeCaddiePaywallBlock: jest.fn(() => null), CADDIE_PAYWALL_DEFERRED_LINE: 'deferred' }));
jest.mock('../../services/dialogEngine', () => ({ getDialog: jest.fn(() => 'Go ahead.') }));
jest.mock('../../services/trustLevelService', () => ({ getTrustLevel: jest.fn(() => 2) }));
jest.mock('../../store/roundStore', () => ({
  useRoundStore: { getState: () => ({
    isRoundActive: true, activeCourse: null, mode: 'stroke', currentHole: 5, shots: [],
    getHolesPlayed: () => 4, getTotalScore: () => 0, getScoreVsPar: () => 0,
  }) },
}));
jest.mock('../../store/settingsStore', () => ({
  useSettingsStore: { getState: () => ({
    voiceEnabled: true, language: mockState.language, voiceGender: 'male', aiProvider: 'gemini',
    caddiePersonality: 'kevin', autoListenEnabled: false,
    caddieAssignments: { round: 'kevin', practice: 'kevin', drills: 'kevin', play: 'kevin' },
  }) },
}));
jest.mock('../../services/intents', () => {
  const { VoiceCommandRouter } = jest.requireActual('../../services/voiceCommandRouter');
  const router = new VoiceCommandRouter();
  router.registerHandler(jest.requireActual('../../services/intents/inRoundDiagnosticHandler').inRoundDiagnosticHandler);
  return { voiceCommandRouter: router };
});
jest.mock('../../services/earbudControl', () => ({ subscribeEarbudTap: jest.fn(() => () => undefined) }));
jest.mock('../../services/responseRouter', () => ({ routeQuery: jest.fn(() => ({ filler: null })) }));
jest.mock('../../services/activeSurfaceRegistry', () => ({ getActiveSurface: jest.fn(() => 'caddie') }));
jest.mock('../../services/pendingDisambiguation', () => ({ resolvePendingCourseUtterance: jest.fn(() => null) }));
jest.mock('../../store/voiceHitRateStore', () => ({ useVoiceHitRateStore: { getState: () => ({ recordLocal: jest.fn(), recordCloud: jest.fn() }) } }));
jest.mock('../../services/apiBase', () => ({
  getApiBaseUrl: () => 'http://localhost:9', isEndpointWarmed: () => true, markEndpointWarmed: jest.fn(),
}));
jest.mock('../../store/flagStore', () => ({ isFlagEnabled: jest.fn(() => true) }));
jest.mock('../../services/adviceFreshness', () => ({
  adviceIsStillWorthSaying: jest.fn(() => true), captureShotEpoch: jest.fn(() => null), currentTurnEpoch: jest.fn(() => null),
}));
jest.mock('../../services/caddieFailureReply', () => ({
  failureNotice: jest.fn(async () => 'FAILURE LINE'),
  failureNoticeSync: jest.fn(() => 'FAILURE LINE'),
  localAnswer: jest.fn(() => null),
}));
jest.mock('../../store/listeningSessionStore', () => ({ useListeningSessionStore: { getState: () => ({ setState: jest.fn() }) } }));
jest.mock('../../services/offlineVoiceCache', () => ({ resolveCachedOfflineClipUri: jest.fn(() => null) }));
jest.mock('../../services/voice/conversationalToolDispatch', () => ({ dispatchConversationalToolActions: jest.fn() }));


type LS = typeof import('../../services/listeningSession');
type CS = typeof import('../../services/conversationState');

jest.setTimeout(120_000);

const flush = async (n = 40) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const said = (text: string): Capture => ({ text, bail: null, heardSpeech: true, durationMs: 1500 });

const UTTERANCE = "what's going on with my swing today, it starts right and slices off the tee";
const diagnostic = (wantsCard = false) => ({
  intent_type: 'in_round_diagnostic',
  confidence: 'high',
  raw_text: UTTERANCE,
  parameters: { pattern_text: 'swing today', ...(wantsCard ? { wants_card: true } : {}) },
  follow_up_question: null,
});

let ls: LS;
let cs: CS;
let realNow: () => number;
let clock = 1_000_000;

beforeEach(() => {
  jest.resetModules();
  Object.assign(mockState, {
    captures: [], spoken: [], brainMessages: [], searches: [], pushes: 0, routes: [], asks: [], precheck: diagnostic(), language: 'en',
  });
  realNow = Date.now;
  clock = 1_000_000;
  Date.now = () => clock;
  ls = require('../../services/listeningSession') as LS;
  cs = require('../../services/conversationState') as CS;
  (global as { fetch?: unknown }).fetch = jest.fn(async () => { throw new Error('offline in test'); });
});
afterEach(() => { Date.now = realNow; ls.forceCloseSession(); cs.clearConversation('test end'); });

const earbud = async (text: string) => {
  clock += 5_000;
  mockState.captures.push(said(text));
  await Promise.race([ls.toggle(), new Promise((r) => setTimeout(r, 10_000))]);
  await flush();
};

describe('earbud in a round: the diagnostic goes through inRoundDiagnosticHandler', () => {
  it('THE BUG: the brain hears the player\'s words, the evidence order and the live block', async () => {
    await earbud(UTTERANCE);
    expect(mockState.asks).toHaveLength(1);
    const ask = mockState.asks[0];
    expect(ask.message).toBe('swing today');
    // History and the style learner keep what he SAID, not the classifier's summary.
    expect(ask.heard).toBe(UTTERANCE);
    expect(String(ask.contextSuffix)).toMatch(/evidence order/i);
    expect(ask.liveBlock).toBe('LIVE VISION: ball in light rough');
    expect(ask.skipTts).toBe(true);
    // A shush still cancels the Sonnet read (Review G2).
    expect(ask.signal).toBeInstanceOf(AbortSignal);
    expect(mockState.spoken).toContain('Face is open to the path — strengthen the grip a touch.');
  });

  it('the offline evidence gate runs on the earbud too: a vague "why" gets the one question, no brain call', async () => {
    mockState.precheck = { ...diagnostic(), raw_text: 'why did that happen', parameters: { pattern_text: 'why' } };
    await earbud('why did that happen');
    expect(mockState.asks).toEqual([]);
    expect(mockState.spoken.some((s) => /which way did it go/i.test(s))).toBe(true);
  });

  it('he is answered in his language', async () => {
    mockState.language = 'es';
    await earbud(UTTERANCE);
    expect(mockState.asks[0].language).toBe('es');
  });

  it('wants_card still opens the diagnostic card with the read', async () => {
    mockState.precheck = diagnostic(true);
    await earbud(UTTERANCE);
    expect(mockState.routes).toEqual([{
      pathname: '/diagnostic-card',
      params: { pattern: 'swing today', reasoning: 'Face is open to the path — strengthen the grip a touch.' },
    }]);
  });
});
