/**
 * 2026-10-31 (caddie-voice CV-2) — A WATCH REPLAY REPLAYS THE CLIP, NOT THE LINE.
 *
 * The double-tap replay used to call speak() on the stored text. Every replay was a fresh /api/voice render
 * (a long answer paid for again), offline it went silent, and speak() logged the line again, so the caddie
 * appeared to have said it twice in the log that feeds the round recap. Now replayLastRenderedClip plays the
 * clip the player already heard, from memory, with no network call; a line with no clip (the device voice,
 * a fixed line) is spoken from the cached persona clips only.
 *
 * Driven through the real watchBridge → handsFreeOrchestrator path; the audio, network and brain are stubbed.
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
  replayLastRenderedClip: jest.fn(async () => false),
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
  hf = require('../../services/handsFreeOrchestrator') as HF;
  ls.initListeningSession();
  hf.startHandsFreeOrchestrator();
});
afterEach(() => { hf.stopHandsFreeOrchestrator(); ls.forceCloseSession(); Date.now = realNow; });

describe('the watch double replays the clip the player already heard', () => {
  it('plays the held clip from memory: no speak(), so no second render and no second log line', async () => {
    const vs = require('../../services/voiceService') as { replayLastRenderedClip: jest.Mock; speakDeviceNotice: jest.Mock };
    vs.replayLastRenderedClip.mockResolvedValueOnce(true);
    mockState.watchTap!('double');
    await flush(80);
    expect(vs.replayLastRenderedClip).toHaveBeenCalledWith('Hit the seven.');
    expect(mockState.spoken).toEqual([]);
    expect(vs.speakDeviceNotice).not.toHaveBeenCalled();
  });

  it('with no clip held for the line, says it from the cached persona clips and still never renders', async () => {
    const vs = require('../../services/voiceService') as { replayLastRenderedClip: jest.Mock; speakDeviceNotice: jest.Mock };
    mockState.watchTap!('double');
    await flush(80);
    expect(vs.replayLastRenderedClip).toHaveBeenCalledWith('Hit the seven.');
    expect(vs.speakDeviceNotice).toHaveBeenCalledWith('Hit the seven.', 'en', 'male');
    expect(mockState.spoken).toEqual([]);
  });
});

describe('the replay path itself', () => {
  it('replayLastRenderedClip makes no render, no log entry and no speak() call', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const src = fs.readFileSync(path.join(__dirname, '../../services/voiceService.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const start = src.indexOf('export const replayLastRenderedClip');
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf('\n};', start));
    expect(body).not.toMatch(/logCaddieLine|pushWatchVoicePrompt|\bspeak\(|\/api\/voice|fetch\(/);
  });
});
