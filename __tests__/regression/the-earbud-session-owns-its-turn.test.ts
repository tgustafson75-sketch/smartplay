/**
 * 2026-10-15 (review G2) — THE EARBUD SESSION, DRIVEN FOR REAL.
 *
 * Every earlier guard on services/listeningSession was a source grep: "the file contains
 * auto_reopen_after_question". The tail that reopens the mic did exist — and the three branches a
 * brain QUESTION comes back through (conversational, route_to_brain, in_round_diagnostic) all
 * returned before reaching it. "What's on your mind today?" left the mic closed, which is the exact
 * 08-11 report, while every grep stayed green.
 *
 * So this suite runs openSession through toggle() with the device edges mocked (mic, speech, brain)
 * and asserts what the PLAYER would get: a second listen after a question, nothing stale spoken into
 * a newer turn, no reopen after a shush, the brain reached when the classifier fails, and a tap that
 * barges in on speech the caddie started on its own.
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
  handler: null as null | { execute: (...args: unknown[]) => Promise<unknown> },
  roundActive: false,
  speakingUserInitiated: false,
  speaking: false,
  stopCalls: 0,
  speakImpl: null as null | ((text: string) => Promise<void>),
};

const noCapture: Capture = { text: null, bail: 'cancelled', heardSpeech: false, durationMs: 0 };
/** Enough evidence (a flight and a lie) that the handler's offline gate hands the read to the brain. */
const SLICE = 'why am I slicing it right off the tee';
const diagnosticHandler = () =>
  jest.requireActual('../../services/intents/inRoundDiagnosticHandler').inRoundDiagnosticHandler as { execute: (...args: unknown[]) => Promise<unknown> };

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
    dispatch: jest.fn((intent: unknown, ctx: unknown) => mockState.handler!.execute(intent, ctx)),
  },
}));
// The real diagnostic handler reads the live vision block first; the device edge answers at once.
jest.mock('../../services/unifiedVisionContext', () => ({ getUnifiedVisionContext: jest.fn(async () => ({ promptBlock: null })) }));
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

describe('finding 1 — a brain QUESTION reopens the mic for the answer', () => {
  it('conversational: "What\'s on your mind today?" → a second listen', async () => {
    mockState.precheck = () => ({ intent_type: 'unknown', confidence: 'high', raw_text: 'hey' });
    mockState.captures.push(said('hey Kevin'));
    mockState.brain.push(async () => ({ text: "What's on your mind today?", audioBase64: null, toolActions: [] }));
    await tap();
    await flush();
    expect(mockState.spoken).toContain("What's on your mind today?");
    expect(mockState.captureCalls).toBe(2);
  });

  it('route_to_brain: a deferred handler whose brain answer is a question → a second listen', async () => {
    mockState.precheck = () => ({ intent_type: 'shot_strategy', confidence: 'high', raw_text: 'whats the play' });
    mockState.handler = { execute: async () => ({ success: true, route_to_brain: true }) };
    mockState.captures.push(said("what's the play"));
    mockState.brain.push(async () => ({ text: 'Driver or three wood off this tee?', audioBase64: null, toolActions: [] }));
    await tap();
    await flush();
    expect(mockState.captureCalls).toBe(2);
  });

  // 2026-10-28 (Brain review r3) — the session has no diagnostic branch of its own any more: the turn
  // is inRoundDiagnosticHandler's, through dispatch, as on every other route.
  it('in_round_diagnostic: the coach asks back → a second listen', async () => {
    mockState.roundActive = true;
    mockState.handler = diagnosticHandler();
    mockState.precheck = () => ({ intent_type: 'in_round_diagnostic', confidence: 'high', raw_text: SLICE, parameters: { pattern_text: 'slicing' } });
    mockState.captures.push(said(SLICE));
    mockState.askCaddie.push(async () => ({ text: 'Is it starting left and curving, or starting right?', audioBase64: null, toolActions: [] }));
    await tap();
    // A handler turn runs behind the "still working" earcon pulse (1.8s apart), as every handler does.
    await new Promise((r) => setTimeout(r, 2_000));
    await flush();
    expect(mockState.captureCalls).toBe(2);
  });

  it('a plain statement does NOT reopen', async () => {
    mockState.precheck = () => ({ intent_type: 'unknown', confidence: 'high', raw_text: 'thanks' });
    mockState.captures.push(said('thanks'));
    mockState.brain.push(async () => ({ text: 'Any time.', audioBase64: null, toolActions: [] }));
    await tap();
    await flush();
    expect(mockState.captureCalls).toBe(1);
  });
});

describe('finding 2 — a stale turn never touches the newer session', () => {
  it('a slow brain answering after shush + re-tap does not idle the new listen, and is not spoken over it', async () => {
    mockState.precheck = () => ({ intent_type: 'unknown', confidence: 'high', raw_text: 'q' });
    const slow = deferred<{ text: string | null; audioBase64: string | null; toolActions: unknown[] }>();
    mockState.captures.push(said('first question'));
    mockState.brain.push(() => slow.promise);
    await tap();
    await flush();
    expect(ls.getSessionState()).toBe('responding');

    // The player shushes, taps again, and asks again — the new capture is still open.
    await tap(); // close
    expect(ls.getSessionState()).toBe('idle');
    const newCapture = deferred<Capture>();
    mockState.captures.push(() => newCapture.promise);
    await tap(); // reopen
    await flush();
    expect(ls.getSessionState()).toBe('listening');

    // The OLD brain answers now.
    slow.resolve({ text: 'Old answer.', audioBase64: null, toolActions: [] });
    await flush();
    expect(ls.getSessionState()).toBe('listening');
    expect(mockState.spoken).not.toContain('Old answer.');

    // The new question still reaches the brain.
    mockState.brain.push(async () => ({ text: 'New answer.', audioBase64: null, toolActions: [] }));
    newCapture.resolve(said('second question'));
    await flush();
    expect(mockState.spoken).toContain('New answer.');
  });

  it('closing the session aborts the in-flight brain request', async () => {
    mockState.roundActive = true;
    mockState.handler = diagnosticHandler();
    mockState.precheck = () => ({ intent_type: 'in_round_diagnostic', confidence: 'high', raw_text: SLICE, parameters: { pattern_text: 'slicing' } });
    const pending = deferred<unknown>();
    mockState.captures.push(said(SLICE));
    mockState.askCaddie.push(() => pending.promise);
    await tap();
    await flush();
    const signal = mockState.askCaddieSignals[0];
    expect(signal).toBeDefined();
    expect(signal!.aborted).toBe(false);
    const spokenBeforeShush = mockState.spoken.length; // the capture-end ack ("Got it.") is fine
    await tap(); // shush
    expect(signal!.aborted).toBe(true);
    pending.resolve(null);
    // Past the handler's earcon pulse: the aborted read declines, and that must not become a brain turn.
    await new Promise((r) => setTimeout(r, 2_000));
    await flush();
    expect(mockState.brainCalls).toBe(0);
    // A turn the player closed owes them nothing — no failure line, no reopen.
    expect(mockState.spoken.slice(spokenBeforeShush)).toEqual([]);
    expect(mockState.captions).toEqual([]);
    expect(mockState.captureCalls).toBe(1);
  });
});

describe('finding 3 — shushing the caddie does not reopen the mic', () => {
  it('a tap during a question-ending handler reply closes it and keeps it closed', async () => {
    mockState.precheck = () => ({ intent_type: 'query_status', confidence: 'high', raw_text: 'score' });
    mockState.handler = { execute: async () => ({ success: true, voice_response: 'You are two over. Want the hole breakdown?' }) };
    mockState.captures.push(said("what's my score"));
    const speaking = deferred<void>();
    mockState.speakImpl = () => speaking.promise;
    await tap();
    await flush();
    expect(mockState.spoken).toContain('You are two over. Want the hole breakdown?');
    await tap(); // shush mid-reply
    speaking.resolve();
    await flush();
    expect(ls.getSessionState()).toBe('idle');
    expect(mockState.captureCalls).toBe(1);
  });
});

describe('finding 5 — a classifier failure still reaches the brain', () => {
  it('mic: /api/voice-intent non-ok → the question is answered by the brain', async () => {
    (global as { fetch?: unknown }).fetch = jest.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    mockState.captures.push(said('what should I hit from 150'));
    mockState.brain.push(async () => ({ text: 'Smooth seven iron.', audioBase64: null, toolActions: [] }));
    await tap();
    await flush();
    expect(mockState.brainCalls).toBe(1);
    expect(mockState.spoken).toContain('Smooth seven iron.');
  });

  it('mic: the classifier THROWS (timeout / no route) → the question is answered by the brain', async () => {
    mockState.captures.push(said('what should I hit from 150'));
    mockState.brain.push(async () => ({ text: 'Smooth seven iron.', audioBase64: null, toolActions: [] }));
    await tap();
    // the hedged second classify attempt waits 2.5s before it too fails
    await new Promise((r) => setTimeout(r, 3_000));
    await flush();
    expect(mockState.brainCalls).toBe(1);
    expect(mockState.spoken).toContain('Smooth seven iron.');
  });

  it('typed / watch: the classifier THROWS → the brain still answers', async () => {
    mockState.brain.push(async () => ({ text: 'About 150 to the middle.', audioBase64: null, toolActions: [] }));
    await ls.handleTranscribedUtterance('how far to the green');
    expect(mockState.brainCalls).toBe(1);
    expect(mockState.spoken).toContain('About 150 to the middle.');
  });
});

describe('finding 6 — a tap barges in on speech the caddie started on its own', () => {
  const vs = () => require('../../services/voiceService') as { stopSpeaking: jest.Mock; playLocalFile: jest.Mock };

  it('proactive speech is stopped before the go-ahead cue, so the mic is not queued behind it', async () => {
    mockState.speaking = true;
    mockState.speakingUserInitiated = false;
    await tap();
    await flush();
    const { stopSpeaking, playLocalFile } = vs();
    expect(stopSpeaking).toHaveBeenCalled();
    expect(playLocalFile).toHaveBeenCalled();
    expect(stopSpeaking.mock.invocationCallOrder[0]).toBeLessThan(playLocalFile.mock.invocationCallOrder[0]);
  });

  it('speech the player asked for is not cut by the open', async () => {
    mockState.speaking = true;
    mockState.speakingUserInitiated = true;
    await tap();
    await flush();
    const { stopSpeaking, playLocalFile } = vs();
    const firstStop = stopSpeaking.mock.invocationCallOrder[0] ?? Infinity;
    expect(firstStop).toBeGreaterThan(playLocalFile.mock.invocationCallOrder[0]);
  });
});

/**
 * 2026-10-25 (Sentry NB–NH, iPhone, build 33, a relaunch mid-round, in_foreground: false, /greeting).
 * An earbud press reached the session while the app was not the open app. iOS refused the recording
 * twice (ND, NF — "recording not started"), the retry was mailed (NH) and the turn ended in "my mic
 * didn't open — tap me again" (NC), which no tap could fix while the app stayed in the background.
 * The echo of the same press was mailed as a failure (NG).
 *
 * The mic is never REFUSED up front — a locked phone with a live audio session may be allowed to
 * record, and pocketed earbud talk is the core on-course flow. Only a start that actually failed
 * while the app was not up is explained, and only a press made stale by a suspended JS thread is
 * dropped.
 */
describe('relaunch — a press while the app is not in the foreground', () => {
  type RN = { AppState: { currentState: string; addEventListener: (e: string, l: (s: string) => void) => { remove: () => void } }; Platform: { OS: string } };
  const rn = () => require('react-native') as RN;
  const log = () => require('../../services/voiceErrorLog') as { logVoiceSilentFail: jest.Mock; logVoiceDiag: jest.Mock };
  const { CADDIE_NOTICE_MIC_NEEDS_APP, CADDIE_NOTICE_MIC_TROUBLE } = require('../../services/caddieAckLines') as typeof import('../../services/caddieAckLines');
  const refused: Capture = { text: null, bail: 'error', heardSpeech: false, durationMs: null };
  let appListeners: Array<(s: string) => void>;
  const realAdd = rn().AppState.addEventListener;
  beforeEach(() => {
    appListeners = [];
    const { AppState } = rn();
    AppState.addEventListener = (_e, l) => { appListeners.push(l); return { remove: () => { appListeners = appListeners.filter((x) => x !== l); } }; };
  });
  afterEach(() => {
    const r = rn();
    r.AppState.currentState = 'active';
    r.AppState.addEventListener = realAdd;
    r.Platform.OS = 'ios';
  });
  const graceElapsed = () => new Promise((r) => setTimeout(r, 1_700));
  const becomeActive = () => { rn().AppState.currentState = 'active'; appListeners.forEach((l) => l('active')); };

  it('THE BUG: iOS, backgrounded, the start is refused — no doomed retry, no "tap me again", it says to open the app', async () => {
    rn().AppState.currentState = 'background';
    mockState.captures.push(refused, refused);
    await tap();
    await flush();
    expect(mockState.captureCalls).toBe(1);
    expect(mockState.spoken).toContain(CADDIE_NOTICE_MIC_NEEDS_APP.en);
    expect(mockState.spoken).not.toContain(CADDIE_NOTICE_MIC_TROUBLE.en);
    expect(log().logVoiceSilentFail).toHaveBeenCalledWith('mic_needs_foreground', expect.objectContaining({ origin: 'tap' }));
    expect(log().logVoiceSilentFail).not.toHaveBeenCalledWith('listen_capture_retry', expect.anything());
    expect(ls.getSessionState()).toBe('idle');
  });

  it('pocketed earbud talk is NOT refused: backgrounded iOS still records at once, and a working mic is just a turn', async () => {
    rn().AppState.currentState = 'background';
    await tap(); // no grace wait — a press settled in the background goes straight to the mic
    expect(mockState.captureCalls).toBe(1);
    expect(mockState.spoken).not.toContain(CADDIE_NOTICE_MIC_NEEDS_APP.en);
  });

  it('the caddie\'s own reopen after a question gets the same honest line, not silence', async () => {
    mockState.precheck = () => ({ intent_type: 'unknown', confidence: 'high', raw_text: 'hey' });
    mockState.captures.push(said('hey'));
    mockState.brain.push(async () => {
      rn().AppState.currentState = 'background'; // the player locks the phone while it answers
      mockState.captures.push(refused, refused);
      return { text: "What's on your mind today?", audioBase64: null, toolActions: [] };
    });
    await tap();
    await flush(60);
    expect(mockState.captureCalls).toBe(2);
    expect(log().logVoiceSilentFail).toHaveBeenCalledWith('mic_needs_foreground', expect.objectContaining({ origin: 'auto_reopen' }));
    expect(mockState.spoken).toContain(CADDIE_NOTICE_MIC_NEEDS_APP.en);
  });

  it('a press while iOS is still bringing the app forward waits for the first active and then listens', async () => {
    rn().AppState.currentState = 'inactive';
    await tap();
    expect(mockState.captureCalls).toBe(0);
    becomeActive();
    await flush();
    expect(mockState.captureCalls).toBe(1);
  });

  it('a press whose wait was frozen by a suspended JS thread is stale — no mic opens minutes later', async () => {
    rn().AppState.currentState = 'inactive';
    await tap();
    clock += 10 * 60_000; // JS suspended; the timer fires on the next wake
    await graceElapsed();
    await flush();
    expect(mockState.captureCalls).toBe(0);
    expect(log().logVoiceDiag).toHaveBeenCalledWith('mic_press_stale', expect.anything());
    expect(ls.getSessionState()).toBe('idle');
  });

  it('foreground is unchanged: a failed start still retries and owns the mic trouble', async () => {
    mockState.captures.push(refused, refused);
    await tap();
    await flush();
    expect(mockState.captureCalls).toBe(2);
    expect(mockState.spoken).toContain(CADDIE_NOTICE_MIC_TROUBLE.en);
    expect(mockState.spoken).not.toContain(CADDIE_NOTICE_MIC_NEEDS_APP.en);
  });

  it('Android is unchanged: a backgrounded failure retries as before', async () => {
    rn().Platform.OS = 'android';
    rn().AppState.currentState = 'background';
    mockState.captures.push(refused, refused);
    await tap();
    await flush();
    expect(mockState.captureCalls).toBe(2);
    expect(mockState.spoken).not.toContain(CADDIE_NOTICE_MIC_NEEDS_APP.en);
  });

  it('the echo of the same press while the mic is opening is absorbed, not mailed as a failure (NG, MD, MP, N2)', async () => {
    rn().AppState.currentState = 'inactive'; // holds the session in 'opening' so the echo lands there
    await tap();
    expect(ls.getSessionState()).toBe('opening');
    clock += 120; // the second event of one press
    await ls.toggle();
    expect(log().logVoiceSilentFail).not.toHaveBeenCalledWith('tap_swallowed', expect.anything());
    expect(log().logVoiceDiag).toHaveBeenCalledWith('tap_echo_absorbed', expect.anything());
    becomeActive();
    await flush();
  });
});
