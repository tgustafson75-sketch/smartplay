/**
 * 2026-10-27 (Sentry SMARTPLAY-CADDIE-MOBILE-PA / -PB, iPhone, App Store build 33) — a real "I'm done"
 * tap was eaten as the OPEN tap's echo: guard open_tap_echo, sessionState listening, msSinceOpen 397/495.
 *
 * The echo window was measured from the moment the MIC opened (800 ms). That was right on 08-07, when
 * 'listening' began at the tap. Since 08-11 'listening' begins only after the spoken open cue, so the
 * window reached well past any echo and swallowed real presses. An echo is the same press arriving
 * again (~350 ms after the TAP, earbudControl's pattern detector), so it is measured from the tap.
 */
let clock = 1_000_000;
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
  cueMs: 0,
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
  // The spoken open cue takes real time: 'listening' arms only after it (listeningSession openSession).
  playLocalFile: jest.fn(async () => { clock += mockState.cueMs; }),
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
  voiceCommandRouter: { getHandler: jest.fn(() => mockState.handler) },
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

beforeEach(() => {
  jest.resetModules();
  Object.assign(mockState, {
    lastSpoken: null, captures: [], captureCalls: 0, spoken: [], captions: [], brain: [], brainCalls: 0,
    askCaddie: [], askCaddieSignals: [], precheck: null, handler: null, roundActive: false,
    speakingUserInitiated: false, speaking: false, stopCalls: 0, speakImpl: null, cueMs: 0,
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


const mocks = () => require('../../services/voiceService') as { endCaptureEarly: jest.Mock };

/** Open a session with a cue of `cueMs`, holding the capture open so the session stays 'listening'. */
async function openWithCue(cueMs: number): Promise<{ tapAt: number; release: () => void }> {
  mockState.cueMs = cueMs;
  const hold = deferred<Capture>();
  mockState.captures.push(() => hold.promise);
  clock += 5_000;
  const tapAt = clock;
  void ls.toggle();
  await flush();
  expect(ls.getSessionState()).toBe('listening');
  return { tapAt, release: () => hold.resolve(noCapture) };
}

async function tapAt(ms: number): Promise<void> {
  clock = ms;
  void ls.toggle();
  await flush();
}

describe('a tap after the mic opens is the player, not an echo', () => {
  it('PA/PB: a press 450 ms after the mic opened (900 ms after the open tap) ends the capture', async () => {
    const s = await openWithCue(450);
    mocks().endCaptureEarly.mockClear();
    await tapAt(s.tapAt + 900);
    expect(mocks().endCaptureEarly).toHaveBeenCalledTimes(1);
    s.release();
  });

  it('the echo that cut the cue short — mic open at +370, echo at +380 — is still absorbed', async () => {
    const s = await openWithCue(370);
    mocks().endCaptureEarly.mockClear();
    await tapAt(s.tapAt + 380);
    expect(mocks().endCaptureEarly).not.toHaveBeenCalled();
    s.release();
  });

  it('with no cue at all, an echo 350 ms after the tap is absorbed', async () => {
    const s = await openWithCue(0);
    mocks().endCaptureEarly.mockClear();
    await tapAt(s.tapAt + 350);
    expect(mocks().endCaptureEarly).not.toHaveBeenCalled();
    s.release();
  });
});
