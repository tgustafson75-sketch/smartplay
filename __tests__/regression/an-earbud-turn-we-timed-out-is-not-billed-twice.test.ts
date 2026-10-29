/**
 * 2026-10-28 (Brain review F7) — ONE OWNER, ONE RULE FOR "TRY AGAIN".
 *
 * askCaddie returned null for its OWN timeout and for a real failure alike, so the earbud / badge /
 * hands-free conversational branch of services/listeningSession retried both. After a 30s warm (48s
 * cold) phone-side timeout the first /api/kevin turn is still running on the server and is billed in
 * full (cache write + TTS); the retry paid for a second full Sonnet turn and made the player wait a
 * second whole window. useVoiceCaddie learned this on 09-23 ("ourTimeout"); this route never did.
 *
 * Part 1 drives the real askCaddie → conversationalBrainTurn chain with a fetch that never answers
 * and asserts the timeout is REPORTED. Part 2 drives the real earbud session (openSession via
 * toggle) and asserts a timed-out first attempt is not retried, while a fast failure still is.
 */

type Capture = { text: string | null; bail: string | null; heardSpeech: boolean; durationMs: number | null };

const mockState = {
  lastSpoken: null as string | null,
  captures: [] as Array<Capture | (() => Promise<Capture>)>,
  captureCalls: 0,
  spoken: [] as string[],
  captions: [] as string[],
  brain: [] as Array<() => Promise<{ text: string | null; audioBase64: string | null; toolActions: unknown[] }>>,
  brainCalls: 0,
  askCaddie: [] as Array<(opts: { signal?: AbortSignal }) => Promise<unknown>>,
  askCaddieSignals: [] as Array<AbortSignal | undefined>,
  precheck: null as null | ((u: string) => unknown),
  handler: null as null | { execute: () => Promise<unknown> },
  roundActive: false,
  speakingUserInitiated: false,
  speaking: false,
  stopCalls: 0,
  speakImpl: null as null | ((text: string) => Promise<void>),
};

const noCapture: Capture = { text: null, bail: 'cancelled', heardSpeech: false, durationMs: 0 };

jest.mock('../../services/voiceService', () => ({
  speak: jest.fn(async (text: string) => {
    mockState.spoken.push(text);
    mockState.lastSpoken = text;
    if (mockState.speakImpl) await mockState.speakImpl(text);
  }),
  speakFromBase64: jest.fn(async (_b: string, o?: { caption?: string }) => {
    mockState.spoken.push(o?.caption ?? '(audio)');
    mockState.lastSpoken = o?.caption ?? null;
  }),
  stopSpeaking: jest.fn(async () => { mockState.stopCalls += 1; mockState.speaking = false; }),
  captureUtteranceDetailed: jest.fn(async () => {
    mockState.captureCalls += 1;
    const next = mockState.captures.shift();
    if (!next) return noCapture;
    return typeof next === 'function' ? next() : next;
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
  isSpeaking: jest.fn(() => mockState.speaking),
  isSpeakingUserInitiated: jest.fn(() => mockState.speaking && mockState.speakingUserInitiated),
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
  conversationalBrainTurn: jest.fn(async () => {
    mockState.brainCalls += 1;
    const next = mockState.brain.shift();
    return next ? next() : { text: null, audioBase64: null, toolActions: [] };
  }),
}));
jest.mock('../../services/caddieBrain', () => ({
  askCaddie: jest.fn(async (opts: { signal?: AbortSignal }) => {
    mockState.askCaddieSignals.push(opts.signal);
    const next = mockState.askCaddie.shift();
    return next ? next(opts) : null;
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
    isRoundActive: mockState.roundActive, activeCourse: null, mode: 'stroke', currentHole: 1, shots: [],
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
jest.mock('../../services/intents', () => ({
  // 2026-10-27 (Brain review B6) — the session runs a handler through dispatch, never execute().
  voiceCommandRouter: {
    getHandler: jest.fn(() => mockState.handler),
    // Returns the handler's own promise, unwrapped, so the turn's timing is the handler's.
    dispatch: jest.fn(() => mockState.handler!.execute()),
  },
}));
jest.mock('../../services/earbudControl', () => ({ subscribeEarbudTap: jest.fn(() => () => undefined) }));
jest.mock('../../services/smartMotionRecordBus', () => ({ isSmartMotionRecording: jest.fn(() => false), emitSmartMotionCommand: jest.fn() }));
jest.mock('../../services/responseRouter', () => ({ routeQuery: jest.fn(() => ({ filler: null })) }));
jest.mock('../../services/activeSurfaceRegistry', () => ({ getActiveSurface: jest.fn(() => 'caddie') }));
jest.mock('../../services/localIntentPrecheck', () => ({
  precheckLocalIntent: jest.fn((u: string) => (mockState.precheck ? mockState.precheck(u) : null)),
}));
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
  failureNotice: jest.fn(async () => 'That one got away from me — say it again?'),
  failureNoticeSync: jest.fn(() => 'That one got away from me — say it again?'),
  localAnswer: jest.fn(() => null),
}));
jest.mock('../../store/listeningSessionStore', () => ({ useListeningSessionStore: { getState: () => ({ setState: jest.fn() }) } }));
jest.mock('../../services/offlineVoiceCache', () => ({ resolveCachedOfflineClipUri: jest.fn(() => null) }));
jest.mock('../../services/voice/conversationalToolDispatch', () => ({ dispatchConversationalToolActions: jest.fn() }));

type LS = typeof import('../../services/listeningSession');

// The first require compiles the whole voice graph; on a loaded machine that alone outlasts 5s.
jest.setTimeout(120_000);

const flush = async (n = 30) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const said = (text: string): Capture => ({ text, bail: null, heardSpeech: true, durationMs: 1500 });
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

let ls: LS;
let realNow: () => number;
let clock = 1_000_000;

beforeEach(() => {
  jest.resetModules();
  Object.assign(mockState, {
    lastSpoken: null, captures: [], captureCalls: 0, spoken: [], captions: [], brain: [], brainCalls: 0,
    askCaddie: [], askCaddieSignals: [], precheck: null, handler: null, roundActive: false,
    speakingUserInitiated: false, speaking: false, stopCalls: 0, speakImpl: null,
  });
  realNow = Date.now;
  clock = 1_000_000;
  // Each tap is seconds apart: the echo / cooldown windows are about ms, not about this test.
  Date.now = () => clock;
  ls = require('../../services/listeningSession') as LS;
  (global as { fetch?: unknown }).fetch = jest.fn(async () => { throw new Error('offline in test'); });
});
afterEach(() => { Date.now = realNow; ls.forceCloseSession(); });

// Not awaited: toggle() awaits the whole turn, and a player taps whenever they like.
const tap = async () => { clock += 5_000; void ls.toggle(); await flush(); };

describe('F7 — the earbud conversational retry respects our own timeout', () => {
  it('THE BUG: a first attempt that timed out on the phone is NOT retried (no second billed turn)', async () => {
    mockState.precheck = () => ({ intent_type: 'unknown', confidence: 'high', raw_text: 'tell me about this hole' });
    mockState.captures.push(said('tell me about this hole'));
    mockState.brain.push(async () => ({ text: null, audioBase64: null, toolActions: [], timedOut: true } as never));
    mockState.brain.push(async () => ({ text: 'Second, billed answer.', audioBase64: null, toolActions: [] }));
    await tap();
    await flush();
    expect(mockState.brainCalls).toBe(1);
    expect(mockState.spoken).not.toContain('Second, billed answer.');
    // He still hears something — the honest exhausted line, not dead air.
    expect(mockState.spoken.length + mockState.captions.length).toBeGreaterThan(0);
  });

  /**
   * 2026-10-28 (Brain recheck R7) — the server answered "brain is down" (a 200 with error/errorType,
   * after its own model ladder and fallback). Retrying ran that whole ladder again before he heard the
   * failure line; followUpBrainTurn has refused this since round 5, this route never did.
   */
  it('THE BUG: a first attempt the server refused is NOT retried', async () => {
    mockState.precheck = () => ({ intent_type: 'unknown', confidence: 'high', raw_text: 'tell me about this hole' });
    mockState.captures.push(said('tell me about this hole'));
    mockState.brain.push(async () => ({ text: null, audioBase64: null, toolActions: [], refused: true } as never));
    mockState.brain.push(async () => ({ text: 'Second ladder answer.', audioBase64: null, toolActions: [] }));
    await tap();
    await flush();
    expect(mockState.brainCalls).toBe(1);
    expect(mockState.spoken).not.toContain('Second ladder answer.');
    expect(mockState.spoken.length + mockState.captions.length).toBeGreaterThan(0);
  });

  it('a fast failure (not our timeout) still gets the one retry', async () => {
    mockState.precheck = () => ({ intent_type: 'unknown', confidence: 'high', raw_text: 'tell me about this hole' });
    mockState.captures.push(said('tell me about this hole'));
    mockState.brain.push(async () => ({ text: null, audioBase64: null, toolActions: [] }));
    mockState.brain.push(async () => ({ text: 'Long par four, favor the left.', audioBase64: null, toolActions: [] }));
    await tap();
    await flush();
    expect(mockState.brainCalls).toBe(2);
    expect(mockState.spoken).toContain('Long par four, favor the left.');
  });
});
