/**
 * 2026-10-31 (caddie-home CAD-HOME-1, shush and overlap) — A CADDIE-HOME TURN HOLDS THE MIC SIGNAL.
 *
 * useCaddieTabMic.processTurn (the avatar and VAD path) drove only the tab's own voiceState. The badge,
 * the bottom bar and toggle() read the shared listening store and its turn counter, so for the whole brain
 * wait the mic stayed bright and said "Tap to talk", and a tap opened a second turn over the first answer.
 * A reply that landed while a typed turn was also answering was spoken over it.
 *
 * Driven on the real hook and the real listeningSession: the brain held at its reply, then the reply
 * held at its speech, with a tap through toggle() at each point. The store, the dim and the tap must agree.
 */
import { micTapLook } from '../../services/voice/tapIsDroppedIn';

jest.setTimeout(120_000);
const flush = async (n = 30) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

function mockEverything(order: string[], hooks: {
  brainReply: { resolve: (v: unknown) => void };
  speechEnd: { resolve: () => void };
  classifier: { reject: (e: Error) => void };
  /** When true, a spoken line stays open until the test ends it. */
  holdSpeech: boolean;
}) {
  jest.doMock('react', () => ({
    useRef: <T,>(v: T) => ({ current: v }),
    useCallback: <T,>(fn: T) => fn,
  }));
  jest.doMock('../../services/voiceService', () => ({
    speak: jest.fn(() => {
      order.push('speak');
      if (!hooks.holdSpeech) return Promise.resolve();
      return new Promise<void>((res) => { hooks.speechEnd.resolve = res; });
    }),
    speakFromBase64: jest.fn(async () => undefined),
    speakDeviceNotice: jest.fn(async () => undefined),
    stopSpeaking: jest.fn(async () => { order.push('stop'); }),
    captureUtteranceDetailed: jest.fn(async () => {
      order.push('capture');
      return { text: '', bail: 'silence', heardSpeech: false, durationMs: 0 };
    }),
    releaseExternalMic: jest.fn(async () => 'none'),
    playLocalFile: jest.fn(async () => { order.push('open_cue'); }),
    stopCapture: jest.fn(async () => undefined),
    endCaptureEarly: jest.fn(() => undefined),
    flashCaption: jest.fn(),
    getLastSpokenLine: jest.fn(() => null),
    isCapturing: jest.fn(() => false),
    isExternalMicActive: jest.fn(() => false),
    getStopGeneration: jest.fn(() => 0),
    isSpeaking: jest.fn(() => false),
    isSpeakingUserInitiated: jest.fn(() => false),
    getCaptionSeq: jest.fn(() => 0),
    activeVoice: jest.fn(() => ({ persona: 'kevin', gender: 'male' })),
  }));
  jest.doMock('../../services/voiceErrorLog', () => ({ logVoiceSilentFail: jest.fn(), logVoiceDiag: jest.fn(), describeError: String }));
  jest.doMock('../../services/voice/turnAnswerWatch', () => ({ createTurnWatch: () => ({ state: jest.fn(), acted: jest.fn() }), noteTurnState: jest.fn(), noteTurnIntent: jest.fn(), noteTurnClosing: jest.fn(), noteTurnActed: jest.fn() }));
  jest.doMock('../../services/conversationalBrain', () => ({ conversationalBrainTurn: jest.fn(async () => ({ text: null, audioBase64: null, toolActions: [] })) }));
  jest.doMock('../../services/caddieBrain', () => ({
    askCaddie: jest.fn(() => new Promise((res) => { hooks.brainReply.resolve = res; })),
  }));
  jest.doMock('../../services/appForeground', () => ({ settleForegroundForMic: jest.fn(async () => 'active'), micMayBeRefusedNow: jest.fn(() => false) }));
  jest.doMock('../../services/voiceWarmup', () => ({ abortVoiceWarmup: jest.fn() }));
  jest.doMock('../../services/userTurnClock', () => ({ noteUserTurn: jest.fn(), getUserTurnEpoch: jest.fn(() => 1) }));
  jest.doMock('../../services/funnelEvents', () => ({ noteCaddieTurn: jest.fn() }));
  jest.doMock('../../services/featureAccess', () => ({ takeCaddiePaywallBlock: jest.fn(() => null), CADDIE_PAYWALL_DEFERRED_LINE: 'deferred' }));
  jest.doMock('../../services/dialogEngine', () => ({ getDialog: jest.fn(() => 'Go ahead.') }));
  jest.doMock('../../services/trustLevelService', () => ({ getTrustLevel: jest.fn(() => 2) }));
  jest.doMock('../../store/roundStore', () => ({ useRoundStore: { getState: () => ({ isRoundActive: false, activeCourse: null, currentHole: 1, shots: [], getHolesPlayed: () => 0, getTotalScore: () => 0, getScoreVsPar: () => 0 }) } }));
  jest.doMock('../../store/settingsStore', () => ({ useSettingsStore: { getState: () => ({ voiceEnabled: true, language: 'en', voiceGender: 'male', aiProvider: 'gemini', caddiePersonality: 'kevin', autoListenEnabled: false, continuousConversationMode: false, caddieAssignments: { round: 'kevin', practice: 'kevin', drills: 'kevin', play: 'kevin' } }) } }));
  jest.doMock('../../services/intents', () => ({ voiceCommandRouter: { getHandler: jest.fn(() => null) } }));
  jest.doMock('../../services/earbudControl', () => ({ subscribeEarbudTap: jest.fn(() => () => undefined) }));
  jest.doMock('../../services/smartMotionRecordBus', () => ({ isSmartMotionRecording: jest.fn(() => false), emitSmartMotionCommand: jest.fn() }));
  jest.doMock('../../services/responseRouter', () => ({ routeQuery: jest.fn(() => ({ filler: null })) }));
  jest.doMock('../../services/activeSurfaceRegistry', () => ({ getActiveSurface: jest.fn(() => 'caddie') }));
  jest.doMock('../../services/localIntentPrecheck', () => ({ precheckLocalIntent: jest.fn(() => null) }));
  jest.doMock('../../services/pendingDisambiguation', () => ({ resolvePendingCourseUtterance: jest.fn(() => null) }));
  jest.doMock('../../store/voiceHitRateStore', () => ({ useVoiceHitRateStore: { getState: () => ({ recordLocal: jest.fn(), recordCloud: jest.fn() }) } }));
  jest.doMock('../../services/apiBase', () => ({ getApiBaseUrl: () => 'http://localhost:9', isEndpointWarmed: () => true, markEndpointWarmed: jest.fn() }));
  jest.doMock('../../services/pendingPuttAsk', () => ({ tryAnswerOpenQuestion: jest.fn(() => null) }));
  jest.doMock('../../store/flagStore', () => ({ isFlagEnabled: jest.fn(() => true) }));
  jest.doMock('../../services/adviceFreshness', () => ({ adviceIsStillWorthSaying: jest.fn(() => true), captureShotEpoch: jest.fn(() => null), currentTurnEpoch: jest.fn(() => null) }));
  jest.doMock('../../services/caddieFailureReply', () => ({ failureNotice: jest.fn(async () => 'x'), failureNoticeSync: jest.fn(() => 'x'), localAnswer: jest.fn(() => null), caddieFailureReply: jest.fn(async () => ({ text: 'x', verdict: null })), keepScoreIfProvenOffline: jest.fn(async () => null) }));
  jest.doMock('../../services/offlineVoiceCache', () => ({ resolveCachedOfflineClipUri: jest.fn(() => null) }));
  jest.doMock('../../services/voice/conversationalToolDispatch', () => ({ dispatchConversationalToolActions: jest.fn() }));
  jest.doMock('../../services/conversationState', () => ({ recordUserTurn: jest.fn(), recordKevinTurn: jest.fn(), isAwaitingFollowUp: jest.fn(() => false) }));
  jest.doMock('../../hooks/useVoiceCaddie', () => ({ endsAsQuestion: () => false, isCloseIntent: () => false }));
  jest.doMock('../../services/featureAccess', () => ({ takeCaddiePaywallBlock: jest.fn(() => null), CADDIE_PAYWALL_DEFERRED_LINE: 'deferred' }));
  jest.doMock('../../store/conversationLogStore', () => ({ useConversationLog: { getState: () => ({ logUser: jest.fn() }) } }));
  jest.doMock('../../store/issueLogStore', () => ({ useIssueLogStore: { getState: () => ({ addVoiceTurn: jest.fn() }) } }));
  jest.doMock('../../store/pointsStore', () => ({ usePointsStore: { getState: () => ({ addPoints: jest.fn() }) } }));
  // The typed/watch turn that overlaps the tab turn is held at its classifier, so it is genuinely in flight.
  let calls = 0;
  (globalThis as { fetch?: unknown }).fetch = jest.fn(() => {
    calls += 1;
    if (calls > 1) return Promise.reject(new Error('offline in test'));
    return new Promise<Response>((_res, rej) => { hooks.classifier.reject = rej; });
  });
}

describe('a caddie-home turn holds the mic signal the badge, the bar and toggle() read', () => {
  afterEach(() => { jest.resetModules(); jest.clearAllMocks(); });

  it('THE BUG: a tab turn in its brain wait dims the mic, a tap is dropped, and the store ends idle', async () => {
    jest.resetModules();
    const order: string[] = [];
    const hooks = { brainReply: { resolve: (_v: unknown) => undefined }, speechEnd: { resolve: () => undefined }, classifier: { reject: (_e: Error) => undefined }, holdSpeech: true };
    mockEverything(order, hooks);
    const ls = require('../../services/listeningSession') as typeof import('../../services/listeningSession');
    const hook = require('../../hooks/useCaddieTabMic') as typeof import('../../hooks/useCaddieTabMic');
    const { useListeningSessionStore } = require('../../store/listeningSessionStore') as typeof import('../../store/listeningSessionStore');
    const mic = hook.useCaddieTabMic({ onKevinSpoke: () => undefined });

    const turn = mic.processTurn('what is the wind doing');
    await flush();
    // The brain is still thinking: the shared store says so, and the badge and bar dim for it.
    expect(useListeningSessionStore.getState().state).toBe('thinking');
    expect(micTapLook(useListeningSessionStore.getState().state)).toEqual({ opacity: 0.4, dropped: true });

    // A tap while the brain is thinking is dropped: no go-ahead cue, no capture, still idle.
    void ls.toggle();
    await flush();
    expect(order).not.toContain('open_cue');
    expect(order).not.toContain('capture');
    expect(ls.getSessionState()).toBe('idle');

    hooks.brainReply.resolve({ text: 'Left to right, ten miles.', audioBase64: null, toolActions: [] });
    await flush();
    // The reply is being spoken: the store reads 'responding' and the mic is live again, so a tap shushes it.
    expect(useListeningSessionStore.getState().state).toBe('responding');
    expect(micTapLook('responding')).toEqual({ opacity: 1, dropped: false });
    void ls.toggle();
    await flush();
    expect(order).toContain('stop');
    expect(order).not.toContain('open_cue');
    expect(order).not.toContain('capture');

    hooks.speechEnd.resolve();
    await turn;
    await flush();
    expect(useListeningSessionStore.getState().state).toBe('idle');
  });

  it('a tab reply that lands while a typed turn is still answering is caption only, never spoken over it', async () => {
    jest.resetModules();
    const order: string[] = [];
    const hooks = { brainReply: { resolve: (_v: unknown) => undefined }, speechEnd: { resolve: () => undefined }, classifier: { reject: (_e: Error) => undefined }, holdSpeech: false };
    mockEverything(order, hooks);
    const ls = require('../../services/listeningSession') as typeof import('../../services/listeningSession');
    const hook = require('../../hooks/useCaddieTabMic') as typeof import('../../hooks/useCaddieTabMic');
    const kevinSpoke: string[] = [];
    const mic = hook.useCaddieTabMic({ onKevinSpoke: (t) => { kevinSpoke.push(t); } });

    const tab = mic.processTurn('what is the wind doing');
    await flush();
    // A typed question is sent while the tab turn is still thinking. It is held at its classifier.
    const typed = ls.handleTranscribedUtterance('and the carry');
    await flush();

    hooks.brainReply.resolve({ text: 'Left to right, ten miles.', audioBase64: null, toolActions: [] });
    await tab;
    await flush();
    expect(kevinSpoke).toEqual(['Left to right, ten miles.']);
    expect(order).not.toContain('speak');

    hooks.classifier.reject(new Error('released by test'));
    await typed.catch(() => undefined);
    await flush();
    expect(ls.getSessionState()).toBe('idle');
  });
});
