/**
 * 2026-10-31 (caddie-voice CV-1b) — A SCREEN THAT HOLDS THE MIC OWNS THE TAP.
 *
 * The swing-review answer and the custom-caddie phrase recorder hold a live Audio.Recording that toggle()'s
 * own states cannot see. An earbud press then played the earbud opener over it, and the opener's audio-mode
 * switch paused that recorder and cut the player's answer short. Those recorders now register with the one
 * mic registry, and toggle() / handMicToPlayer() treat a busy registry as a held mic: the tap is dropped with
 * the same buzz and log as any other dropped tap, and no opener is played over the recording.
 *
 * Driven on the real listeningSession with the audio, network and brain stubbed; a source guard then checks
 * that every screen which starts a recorder registers it.
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
  externalMicHeld: false,
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
  isExternalMicActive: jest.fn(() => mockState.externalMicHeld),
  endHeldUtterance: jest.fn(async () => 'none'),
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
type HF = typeof import('../../services/handsFreeOrchestrator');
let ls: LS; let hf: HF;
let realNow: () => number;

const flush = async (n = 40) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

beforeEach(() => {
  jest.resetModules();
  Object.assign(mockState, { speaking: false, cueHold: null, replyHold: null, captures: [], spoken: [], stopCalls: [], watchTap: null, externalMicHeld: false });
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
  hf = require('../../services/handsFreeOrchestrator') as HF;
  ls.initListeningSession();
  hf.startHandsFreeOrchestrator();
});
afterEach(() => { hf.stopHandsFreeOrchestrator(); ls.forceCloseSession(); Date.now = realNow; });

describe('a screen that holds the mic owns the tap', () => {
  it('a tap while a screen recorder holds the mic opens nothing, plays no opener, and is logged as dropped', async () => {
    mockState.externalMicHeld = true;
    await ls.toggle();
    await flush();
    const vs = require('../../services/voiceService') as { playLocalFile: jest.Mock; captureUtteranceDetailed: jest.Mock };
    expect(vs.playLocalFile).not.toHaveBeenCalled();
    expect(vs.captureUtteranceDetailed).not.toHaveBeenCalled();
    expect(ls.getSessionState()).toBe('idle');
    const vlog = require('../../services/voiceErrorLog') as { logVoiceSilentFail: jest.Mock };
    expect(vlog.logVoiceSilentFail.mock.calls.some((c) => c[0] === 'tap_swallowed' && (c[1] as { guard?: string }).guard === 'mic_held_elsewhere')).toBe(true);
  });

  it('the auto hand-off yields to a screen recorder the same way it yields to a live session', async () => {
    mockState.externalMicHeld = true;
    const open = jest.fn();
    expect(ls.handMicToPlayer(open, 'test')).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it('with the mic free, the tap still opens the session', async () => {
    mockState.externalMicHeld = false;
    await ls.toggle();
    await flush();
    const vs = require('../../services/voiceService') as { playLocalFile: jest.Mock };
    expect(vs.playLocalFile).toHaveBeenCalled();
  });
});

describe('every recorder says it holds the mic', () => {
  it('a screen or hook that starts an Audio.Recording registers it with the mic registry', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const root = path.join(__dirname, '../..');
    const dirs = ['app', 'services', 'hooks', 'components'];
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of fs.readdirSync(dir)) {
        const p = path.join(dir, name);
        if (fs.statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(name)) files.push(p);
      }
    };
    for (const d of dirs) walk(path.join(root, d));
    // Comments are stripped first, so prose about a recorder cannot satisfy or trip the guard.
    const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    // voiceService is the arbiter: it checks the registry itself before every capture, so it creates recorders
    // on the session's behalf and is not a holder of its own.
    const exempt = new Set([path.join(root, 'services/voiceService.ts')]);
    const unregistered = files
      .filter((f) => !exempt.has(f))
      .filter((f) => /Recording\.createAsync\(/.test(strip(fs.readFileSync(f, 'utf8'))))
      .filter((f) => !/registerExternalMicCheck\(/.test(strip(fs.readFileSync(f, 'utf8'))))
      .map((f) => path.relative(root, f));
    expect(unregistered).toEqual([]);
  });
});
