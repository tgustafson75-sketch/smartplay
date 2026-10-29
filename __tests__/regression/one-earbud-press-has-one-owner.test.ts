/**
 * 2026-10-28 (voice engineering review, VOICE-ENG-1) — EVERY EARBUD PRESS HAD TWO OWNERS.
 *
 * earbudControl fans one press out twice: at once to listeningSession's own subscriber (which
 * toggles), and ~350 ms later, classified, to handsFreeOrchestrator — whose 'single' called toggle()
 * AGAIN, after an unconditional stopSpeaking(). So one press:
 *   - clipped the caddie's own open cue ("Yeah?") 350 ms into it;
 *   - in 'responding', closed the reply and then reached toggle() a second time, which the
 *     close-echo guard absorbed and MAILED as a tap_swallowed failure for a tap that worked;
 *   - a double/triple during a live turn acted on presses the session had already consumed.
 *
 * Driven through the real earbudControl → handsFreeOrchestrator → listeningSession chain; only the
 * audio, the network and the brain are stubbed.
 */
let clock = 7_000_000;
type Capture = { text: string | null; bail: string | null; heardSpeech: boolean; durationMs: number | null };

const mockState = {
  speaking: false,
  cueHold: null as null | Promise<void>,
  replyHold: null as null | Promise<void>,
  captures: [] as (Capture | (() => Promise<Capture>))[],
  spoken: [] as string[],
  stopCalls: [] as string[],
  watchTap: null as null | ((p: string) => void),
};

jest.mock('../../services/voiceService', () => ({
  speak: jest.fn(async (text: string) => {
    mockState.spoken.push(text);
    mockState.speaking = true;
    if (mockState.replyHold) await mockState.replyHold;
    mockState.speaking = false;
  }),
  speakFromBase64: jest.fn(async () => undefined),
  stopSpeaking: jest.fn(async (why?: string) => { mockState.stopCalls.push(String(why)); mockState.speaking = false; }),
  captureUtteranceDetailed: jest.fn(async () => {
    const next = mockState.captures.shift();
    if (!next) return { text: null, bail: 'cancelled', heardSpeech: false, durationMs: 0 };
    return typeof next === 'function' ? next() : next;
  }),
  releaseExternalMic: jest.fn(async () => 'none'),
  // The spoken open cue: audibly playing until the test lets it finish.
  playLocalFile: jest.fn(async () => {
    mockState.speaking = true;
    if (mockState.cueHold) await mockState.cueHold;
    mockState.speaking = false;
  }),
  stopCapture: jest.fn(async () => undefined),
  endCaptureEarly: jest.fn(),
  flashCaption: jest.fn(),
  getLastSpokenLine: jest.fn(() => 'Hit the seven.'),
  isCapturing: jest.fn(() => false),
  isExternalMicActive: jest.fn(() => false),
  speakDeviceNotice: jest.fn(async () => undefined),
  isSpeaking: jest.fn(() => mockState.speaking),
  isSpeakingUserInitiated: jest.fn(() => mockState.speaking),
  getCaptionSeq: jest.fn(() => 0),
  activeVoice: jest.fn(() => ({ persona: 'kevin', gender: 'male' })),
}));
jest.mock('../../services/voiceErrorLog', () => ({
  logVoiceSilentFail: jest.fn(), logVoiceDiag: jest.fn(), describeError: (e: unknown) => String(e),
}));
jest.mock('../../services/watchBridge', () => ({
  subscribeWatchTap: (cb: (p: string) => void) => { mockState.watchTap = cb; return () => undefined; },
  subscribeWatchVoice: () => () => undefined,
  subscribeWatchCommand: () => () => undefined,
}));
jest.mock('../../store/toastStore', () => ({ useToastStore: { getState: () => ({ show: jest.fn() }) } }));
jest.mock('../../services/voice/turnAnswerWatch', () => ({
  noteTurnState: jest.fn(), noteTurnIntent: jest.fn(), noteTurnClosing: jest.fn(), noteTurnActed: jest.fn(),
}));
jest.mock('../../services/conversationalBrain', () => ({
  conversationalBrainTurn: jest.fn(async () => ({ text: 'Hit the seven.', audioBase64: null, toolActions: [] })),
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
jest.mock('../../services/smartMotionRecordBus', () => ({
  isSmartMotionRecording: jest.fn(() => false), emitSmartMotionCommand: jest.fn(), isSmartMotionActive: jest.fn(() => false),
}));
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

jest.setTimeout(120_000);

type LS = typeof import('../../services/listeningSession');
type EC = typeof import('../../services/earbudControl');
type HF = typeof import('../../services/handsFreeOrchestrator');
let ls: LS; let ec: EC; let hf: HF;
let realNow: () => number;

const flush = async (n = 40) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
/** Real time for earbudControl's 350 ms pattern window; the session's own clock is moved by hand. */
const waitPattern = async () => { clock += 350; await new Promise((r) => setTimeout(r, 420)); await flush(); };
function deferred() { let release!: () => void; const p = new Promise<void>((r) => { release = r; }); return { p, release }; }
const vlog = () => require('../../services/voiceErrorLog') as { logVoiceSilentFail: jest.Mock; logVoiceDiag: jest.Mock };
const mailedSwallows = () => vlog().logVoiceSilentFail.mock.calls.filter((c) => c[0] === 'tap_swallowed');
const press = async (atMs: number) => { clock = atMs; ec.notifyEarbudTap(); await flush(); };

beforeEach(() => {
  jest.resetModules();
  Object.assign(mockState, { speaking: false, cueHold: null, replyHold: null, captures: [], spoken: [], stopCalls: [], watchTap: null });
  realNow = Date.now;
  clock = 7_000_000;
  Date.now = () => clock;
  (global as { fetch?: unknown }).fetch = jest.fn(async (url: string) => {
    if (String(url).includes('/api/voice-intent')) {
      return { ok: true, status: 200, json: async () => ({ intent_type: 'conversational', confidence: 'high' }) };
    }
    throw new Error('offline in test');
  });
  ls = require('../../services/listeningSession') as LS;
  ec = require('../../services/earbudControl') as EC;
  hf = require('../../services/handsFreeOrchestrator') as HF;
  ls.initListeningSession();
  hf.startHandsFreeOrchestrator();
});
afterEach(() => { hf.stopHandsFreeOrchestrator(); ls.forceCloseSession(); Date.now = realNow; });

describe('one earbud press, one owner', () => {
  it('the open cue is not clipped 350 ms in by the pattern handler', async () => {
    const cue = deferred();
    mockState.cueHold = cue.p;
    await press(clock + 5_000);
    expect(ls.getSessionState()).toBe('opening');
    expect(mockState.speaking).toBe(true);          // "Yeah?" is playing
    await waitPattern();                             // the press resolves as a 'single' pattern
    expect(mockState.stopCalls).toEqual([]);         // nothing cut it
    expect(mailedSwallows()).toEqual([]);
    cue.release();
  });

  it('a shush during the reply closes once and mails nothing', async () => {
    const reply = deferred();
    mockState.replyHold = reply.p;
    const cue = deferred();
    mockState.cueHold = cue.p;
    mockState.captures.push({ text: 'what club from here', bail: null, heardSpeech: true, durationMs: 1500 });
    await press(clock + 5_000);
    await waitPattern();                             // the OPEN press's pattern resolves while opening
    cue.release();
    await flush(80);
    expect(ls.getSessionState()).toBe('responding');
    vlog().logVoiceSilentFail.mockClear();
    await press(clock + 4_000);                      // the shush
    expect(ls.getSessionState()).toBe('idle');
    await waitPattern();                             // its 'single' pattern arrives ~350 ms later
    expect(ls.getSessionState()).toBe('idle');       // not reopened
    expect(mailedSwallows()).toEqual([]);            // and not reported as a lost tap
    reply.release();
  });

  it("iOS's duplicate command for the same shush is absorbed as an echo — kept on device, not mailed", async () => {
    const reply = deferred();
    mockState.replyHold = reply.p;
    const cue = deferred();
    mockState.cueHold = cue.p;
    mockState.captures.push({ text: 'what club from here', bail: null, heardSpeech: true, durationMs: 1500 });
    await press(clock + 5_000);
    await waitPattern();
    cue.release();
    await flush(80);
    expect(ls.getSessionState()).toBe('responding');
    vlog().logVoiceSilentFail.mockClear();
    vlog().logVoiceDiag.mockClear();
    const at = clock + 4_000;
    await press(at);                                 // play
    await press(at + 120);                           // togglePlayPause, same button
    expect(ls.getSessionState()).toBe('idle');
    expect(mailedSwallows()).toEqual([]);
    expect(vlog().logVoiceDiag.mock.calls.some((c) => c[0] === 'tap_echo_absorbed' && c[1]?.guard === 'close_tap_echo')).toBe(true);
    reply.release();
  });

  it('a double press during a live turn does not also replay the last line over it', async () => {
    const cue = deferred();
    mockState.cueHold = cue.p;
    const at = clock + 5_000;
    await press(at);
    await press(at + 150);
    await waitPattern();                             // resolves as 'double'
    expect(mockState.spoken).toEqual([]);            // no replay spoken into the opening turn
    expect(mockState.stopCalls).toEqual([]);
    cue.release();
  });

  it('the watch, which has no other path, still opens the mic with one tap', async () => {
    const cue = deferred();
    mockState.cueHold = cue.p;
    mockState.watchTap!('single');
    await flush(80);
    expect(ls.getSessionState()).toBe('opening');
    cue.release();
  });
});
