/**
 * 2026-10-28 (Brain review B3) — AN ANSWER TO THE CADDIE'S QUESTION IS NOT A COMMAND.
 *
 * Kevin ends on "Go for it or lay up short of the creek?" and Tim answers "go for it" on the earbud,
 * the Caddie tab's bottom-bar mic or the typed box. Only the avatar mic knew Kevin had just asked
 * something; these routes ran the precheck, which reads "go for it" as change_setting risk_mode
 * aggressive — aggressive for the REST OF THE ROUND, "Aggressive it is", and no club.
 *
 * Driven for real: the real conversationState, the real precheck and the real router; only the mic,
 * the speaker and the brain are mocked. The brain must get the answer, and no setting may change.
 */

type Capture = { text: string | null; bail: string | null; heardSpeech: boolean; durationMs: number | null };

const mockState = {
  lastSpoken: null as string | null,
  captures: [] as Capture[],
  captureCalls: 0,
  spoken: [] as string[],
  captions: [] as string[],
  brainMessages: [] as string[],
  brainReply: "Here's the club." as string | null,
  precheck: null as null | ((u: string) => unknown),
  flags: {} as Record<string, boolean>,
  roundActive: false,
  logPutts: [] as [number, number][],
};

const noCapture: Capture = { text: null, bail: 'cancelled', heardSpeech: false, durationMs: 0 };

jest.mock('../../services/voiceService', () => ({
  speak: jest.fn(async (text: string) => { mockState.spoken.push(text); mockState.lastSpoken = text; }),
  speakFromBase64: jest.fn(async (_b: string, o?: { caption?: string }) => {
    mockState.spoken.push(o?.caption ?? '(audio)');
    mockState.lastSpoken = o?.caption ?? null;
  }),
  stopSpeaking: jest.fn(async () => undefined),
  captureUtteranceDetailed: jest.fn(async () => {
    mockState.captureCalls += 1;
    return mockState.captures.shift() ?? noCapture;
  }),
  releaseExternalMic: jest.fn(async () => 'none'),
  playLocalFile: jest.fn(async () => undefined),
  stopCapture: jest.fn(async () => undefined),
  endCaptureEarly: jest.fn(),
  flashCaption: jest.fn((t: string) => { mockState.captions.push(t); }),
  getLastSpokenLine: jest.fn(() => mockState.lastSpoken),
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
// The brain is the device edge: record WHAT it was asked, answer with a plain statement.
jest.mock('../../services/conversationalBrain', () => ({
  conversationalBrainTurn: jest.fn(async (message: string) => {
    mockState.brainMessages.push(message);
    return { text: mockState.brainReply, audioBase64: null, toolActions: [] };
  }),
}));
jest.mock('../../services/caddieBrain', () => ({ askCaddie: jest.fn(async () => null) }));
jest.mock('../../services/voiceWarmup', () => ({ abortVoiceWarmup: jest.fn() }));
jest.mock('../../services/userTurnClock', () => ({ noteUserTurn: jest.fn(), getUserTurnEpoch: jest.fn(() => 1) }));
jest.mock('../../services/funnelEvents', () => ({ noteCaddieTurn: jest.fn() }));
jest.mock('../../services/featureAccess', () => ({ takeCaddiePaywallBlock: jest.fn(() => null), CADDIE_PAYWALL_DEFERRED_LINE: 'deferred' }));
jest.mock('../../services/dialogEngine', () => ({ getDialog: jest.fn(() => 'Go ahead.') }));
jest.mock('../../services/trustLevelService', () => ({ getTrustLevel: jest.fn(() => 2) }));
jest.mock('../../store/roundStore', () => ({
  useRoundStore: { getState: () => ({
    isRoundActive: mockState.roundActive, activeCourse: null, mode: 'stroke', currentHole: 5, shots: [],
    getHolesPlayed: () => 4, getTotalScore: () => 0, getScoreVsPar: () => 0,
    logPutts: (hole: number, putts: number) => { mockState.logPutts.push([hole, putts]); },
  }) },
}));
jest.mock('../../store/settingsStore', () => ({
  useSettingsStore: { getState: () => ({
    voiceEnabled: true, language: 'en', voiceGender: 'male', aiProvider: 'gemini',
    caddiePersonality: 'kevin', autoListenEnabled: false,
    caddieAssignments: { round: 'kevin', practice: 'kevin', drills: 'kevin', play: 'kevin' },
  }) },
}));
// The REAL router, empty: each test registers the handlers it watches. Every rule dispatch owns
// (kill switch, low confidence, TightLie gate, the open offer) is the shipped code.
jest.mock('../../services/intents', () => {
  const { VoiceCommandRouter } = jest.requireActual('../../services/voiceCommandRouter');
  return { voiceCommandRouter: new VoiceCommandRouter() };
});
jest.mock('../../services/earbudControl', () => ({ subscribeEarbudTap: jest.fn(() => () => undefined) }));
// smartMotionRecordBus stays real: a plain in-memory bus the real precheck reads.
jest.mock('../../services/responseRouter', () => ({ routeQuery: jest.fn(() => ({ filler: null })) }));
jest.mock('../../services/activeSurfaceRegistry', () => ({ getActiveSurface: jest.fn(() => 'caddie') }));
// The real precheck unless a test pins what the classifier would say.
jest.mock('../../services/localIntentPrecheck', () => {
  const actual = jest.requireActual('../../services/localIntentPrecheck');
  return { ...actual, precheckLocalIntent: jest.fn((u: string) => (mockState.precheck ? mockState.precheck(u) : actual.precheckLocalIntent(u))) };
});
jest.mock('../../services/pendingDisambiguation', () => ({ resolvePendingCourseUtterance: jest.fn(() => null) }));
jest.mock('../../store/voiceHitRateStore', () => ({ useVoiceHitRateStore: { getState: () => ({ recordLocal: jest.fn(), recordCloud: jest.fn() }) } }));
jest.mock('../../services/apiBase', () => ({
  getApiBaseUrl: () => 'http://localhost:9', isEndpointWarmed: () => true, markEndpointWarmed: jest.fn(),
}));
jest.mock('../../store/flagStore', () => ({ isFlagEnabled: jest.fn((name: string) => mockState.flags[name] ?? true) }));
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
type Router = import('../../services/voiceCommandRouter').VoiceCommandRouter;
type CS = typeof import('../../services/conversationState');

jest.setTimeout(120_000);

const flush = async (n = 40) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const said = (text: string): Capture => ({ text, bail: null, heardSpeech: true, durationMs: 1500 });

let ls: LS;
let router: Router;
let cs: CS;
let realNow: () => number;
let clock = 1_000_000;

/** A handler the test watches: records every execute and answers with `result`. */
function watch(intent_type: string, result: Record<string, unknown> = { success: true, voice_response: `ran ${intent_type}`, side_effects: [], follow_up_needed: false }) {
  const calls: { intent: { intent_type: string; confidence: string; parameters?: Record<string, unknown> } }[] = [];
  router.registerHandler({
    intent_type,
    execute: jest.fn(async (intent: never) => { calls.push({ intent }); return result as never; }),
  } as never);
  return calls;
}

beforeEach(() => {
  jest.resetModules();
  Object.assign(mockState, {
    lastSpoken: null, captures: [], captureCalls: 0, spoken: [], captions: [], brainMessages: [],
    brainReply: "Here's the club.", precheck: null, flags: {}, roundActive: false, logPutts: [],
  });
  realNow = Date.now;
  clock = 1_000_000;
  Date.now = () => clock;
  ls = require('../../services/listeningSession') as LS;
  router = (require('../../services/intents') as { voiceCommandRouter: Router }).voiceCommandRouter;
  cs = require('../../services/conversationState') as CS;
  (global as { fetch?: unknown }).fetch = jest.fn(async () => { throw new Error('offline in test'); });
});
afterEach(() => { Date.now = realNow; ls.forceCloseSession(); cs.clearConversation('test end'); });

/** The earbud / bottom-bar mic: one tap, one utterance, the whole turn. */
const earbud = async (text: string) => {
  clock += 5_000;
  mockState.captures.push(said(text));
  // toggle() resolves when the turn ends; a handler slower than a tick waits out the thinking earcon.
  await Promise.race([ls.toggle(), new Promise((r) => setTimeout(r, 10_000))]);
  await flush();
};
/** The typed box / watch. */
const typed = async (text: string) => { clock += 5_000; await ls.handleTranscribedUtterance(text); await flush(); };

const QUESTION = 'Go for it or lay up short of the creek?';

describe('B3 — the caddie\'s question owns the answer', () => {
  it('the hazard is real: the precheck alone reads "go for it" as a setting change', () => {
    const { precheckLocalIntent } = jest.requireActual('../../services/localIntentPrecheck');
    expect(precheckLocalIntent('go for it')?.intent_type).toBe('change_setting');
  });

  it('earbud / bottom-bar mic: "go for it" after his question reaches the brain, not change_setting', async () => {
    mockState.roundActive = true;
    const settings = watch('change_setting');
    cs.recordKevinTurn(QUESTION);
    await earbud('go for it');
    expect(settings).toHaveLength(0);
    expect(mockState.brainMessages).toEqual(['go for it']);
    expect(mockState.spoken).toContain("Here's the club.");
  });

  it('typed box / watch: "go for it" after his question reaches the brain, not change_setting', async () => {
    mockState.roundActive = true;
    const settings = watch('change_setting');
    cs.recordKevinTurn(QUESTION);
    await typed('go for it');
    expect(settings).toHaveLength(0);
    expect(mockState.brainMessages).toEqual(['go for it']);
  });

  it('typed: "play it safe" after his question is an answer too', async () => {
    mockState.roundActive = true;
    const settings = watch('change_setting');
    cs.recordKevinTurn(QUESTION);
    await typed('play it safe');
    expect(settings).toHaveLength(0);
    expect(mockState.brainMessages).toEqual(['play it safe']);
  });

  it('the bypass is ONE turn: the caddie\'s statement in between makes "go for it" a command again', async () => {
    mockState.roundActive = true;
    const settings = watch('change_setting');
    cs.recordKevinTurn(QUESTION);
    await typed('what is the carry over the creek');
    // The brain answered with a statement, which is now the last turn — no open question.
    await typed('go for it');
    expect(settings).toHaveLength(1);
  });

  it('with no question open, "go for it" still sets the mode (the bypass is scoped, not a blanket)', async () => {
    mockState.roundActive = true;
    const settings = watch('change_setting');
    await earbud('go for it');
    expect(settings).toHaveLength(1);
  });
});
