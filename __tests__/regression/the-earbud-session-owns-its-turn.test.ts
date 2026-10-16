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

  it('in_round_diagnostic: the coach asks back → a second listen', async () => {
    mockState.roundActive = true;
    mockState.precheck = () => ({ intent_type: 'in_round_diagnostic', confidence: 'high', raw_text: 'why am I slicing', parameters: {} });
    mockState.captures.push(said('why am I slicing'));
    mockState.askCaddie.push(async () => ({ text: 'Is it starting left and curving, or starting right?', audioBase64: null, toolActions: [] }));
    await tap();
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
    mockState.precheck = () => ({ intent_type: 'in_round_diagnostic', confidence: 'high', raw_text: 'why', parameters: {} });
    const pending = deferred<unknown>();
    mockState.captures.push(said('why am I slicing'));
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
    await flush();
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
