/**
 * 2026-10-28 (voice engineering review, VOICE-ENG-3) — A TAP QUEUED DURING 'opening' WAS LOST.
 *
 * Since 08-22 a real second press while the mic is still opening (the spoken cue is playing) is
 * remembered and applied "the instant the mic is live, as I'm done". It never was:
 *   - listeningSession applied it by calling endCaptureEarly() BEFORE captureUtteranceDetailed was
 *     called — no recorder existed, and endCaptureEarly is a no-op without one;
 *   - captureUtteranceDetailed then reset the early-stop flag on entry anyway, and the recorder is
 *     only created after several awaits (permission, audio mode, createAsync).
 * So the press vanished and the mic ran on to the VAD or the 8s cap, and the "Got it" cue the press
 * asks for never played.
 *
 * Two halves, each driven for real:
 *   1. the real captureUtteranceDetailed (expo-av stubbed, createAsync delayed): an endCaptureEarly
 *      that lands after the capture started but before its recorder exists still ends it;
 *   2. the real listeningSession: the queued tap reaches the capture after it has started, and the
 *      turn plays the "Got it" cue rather than the silence-ended device ack.
 */

// ── Half 1: the real capture ───────────────────────────────────────────────────────────────────
const mockRec = {
  releaseCreate: null as null | (() => void),
  startedAt: 0,
  stoppedAt: -1,
};

jest.mock('expo-av', () => {
  const leaf = new Proxy({}, { get: (_t, p) => String(p) });
  return {
    __esModule: true,
    InterruptionModeIOS: leaf,
    InterruptionModeAndroid: leaf,
    Audio: {
      AndroidOutputFormat: leaf, AndroidAudioEncoder: leaf, IOSOutputFormat: leaf, IOSAudioQuality: leaf,
      requestPermissionsAsync: async () => ({ granted: true }),
      setAudioModeAsync: async () => undefined,
      Sound: { createAsync: async () => ({ sound: { unloadAsync: async () => undefined, stopAsync: async () => undefined } }) },
      Recording: {
        // A cold mic: the recorder comes up only when the test says so.
        createAsync: async () => {
          await new Promise<void>((r) => { mockRec.releaseCreate = r; });
          mockRec.startedAt = Date.now();
          return {
            recording: {
              getURI: () => 'file:///capture.m4a',
              getStatusAsync: async () => ({ durationMillis: Date.now() - mockRec.startedAt }),
              stopAndUnloadAsync: async () => { mockRec.stoppedAt = Date.now() - mockRec.startedAt; },
            },
          };
        },
      },
    },
  };
});
jest.mock('expo-file-system/legacy', () => ({ getInfoAsync: async () => ({ exists: true, size: 40_000 }) }));

jest.setTimeout(120_000);
const flush = async (n = 30) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

describe('an "I\'m done" that lands before the recorder is up', () => {
  afterEach(() => jest.useRealTimers());

  it('ends the capture as soon as it records, instead of running to the 8s cap', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    mockRec.releaseCreate = null; mockRec.stoppedAt = -1;
    (globalThis as { fetch?: unknown }).fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ text: 'x' }), text: async () => '' }));
    const vs = jest.requireActual('../../services/voiceService') as typeof import('../../services/voiceService');
    const p = vs.captureUtteranceDetailed(8_000, 'https://api.test');
    for (let i = 0; i < 50 && !mockRec.releaseCreate; i++) await jest.advanceTimersByTimeAsync(10);
    expect(mockRec.releaseCreate).not.toBeNull();   // the capture is waiting on the recorder
    vs.endCaptureEarly();                            // the queued tap arrives in that gap
    mockRec.releaseCreate!();
    await jest.advanceTimersByTimeAsync(9_000);
    const out = await p;
    expect(mockRec.stoppedAt).toBeGreaterThanOrEqual(0);
    expect(mockRec.stoppedAt).toBeLessThan(500);     // the tap ended it; not the 8s cap
    expect(out.bail).toBe('too_short');               // nothing said yet — and nothing billed
  });

  it('a latch never outlives its capture: the next capture runs normally', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    mockRec.releaseCreate = null; mockRec.stoppedAt = -1;
    const vs = jest.requireActual('../../services/voiceService') as typeof import('../../services/voiceService');
    vs.endCaptureEarly();                            // nothing capturing: must be a no-op
    const p = vs.captureUtteranceDetailed(2_000, 'https://api.test');
    for (let i = 0; i < 50 && !mockRec.releaseCreate; i++) await jest.advanceTimersByTimeAsync(10);
    mockRec.releaseCreate!();
    await jest.advanceTimersByTimeAsync(60_000);    // its cap, then the transcribe and its budgets
    await p;
    expect(mockRec.stoppedAt).toBeGreaterThanOrEqual(1_900);  // ran to its own cap
  });
});

// ── Half 2: the real listeningSession hands the queued tap to the capture ───────────────────────
describe('a tap queued during opening', () => {
  it('reaches the capture after it starts, and the turn plays the "Got it" cue', async () => {
    jest.resetModules();
    let clock = 5_000_000;
    const realNow = Date.now;
    Date.now = () => clock;
    let releaseCue: () => void = () => {};
    let cueCalls = 0;
    const order: string[] = [];
    const deviceAcks: string[] = [];
    jest.doMock('../../services/voiceService', () => ({
      speak: jest.fn(async () => undefined),
      speakFromBase64: jest.fn(async () => undefined),
      stopSpeaking: jest.fn(async () => undefined),
      captureUtteranceDetailed: jest.fn(async () => {
        order.push('capture');
        return { text: 'what club here', bail: null, heardSpeech: true, durationMs: 1500 };
      }),
      releaseExternalMic: jest.fn(async () => 'none'),
      // The open cue is still playing until the test releases it; later calls are the got-it cue.
      playLocalFile: jest.fn(async () => {
        cueCalls += 1;
        order.push(cueCalls === 1 ? 'open_cue' : 'gotit_cue');
        if (cueCalls === 1) await new Promise<void>((r) => { releaseCue = r; });
      }),
      stopCapture: jest.fn(async () => undefined),
      endCaptureEarly: jest.fn(() => { order.push('endCaptureEarly'); }),
      flashCaption: jest.fn(),
      getLastSpokenLine: jest.fn(() => null),
      isCapturing: jest.fn(() => false),
      isExternalMicActive: jest.fn(() => false),
      speakDeviceNotice: jest.fn(async (t: string) => { deviceAcks.push(t); }),
      isSpeaking: jest.fn(() => false),
      isSpeakingUserInitiated: jest.fn(() => false),
      getCaptionSeq: jest.fn(() => 0),
      activeVoice: jest.fn(() => ({ persona: 'kevin', gender: 'male' })),
    }));
    jest.doMock('../../services/voiceErrorLog', () => ({ logVoiceSilentFail: jest.fn(), logVoiceDiag: jest.fn(), describeError: String }));
    jest.doMock('../../services/voice/turnAnswerWatch', () => ({ noteTurnState: jest.fn(), noteTurnIntent: jest.fn(), noteTurnClosing: jest.fn(), noteTurnActed: jest.fn() }));
    jest.doMock('../../services/conversationalBrain', () => ({ conversationalBrainTurn: jest.fn(async () => ({ text: null, audioBase64: null, toolActions: [] })) }));
    jest.doMock('../../services/caddieBrain', () => ({ askCaddie: jest.fn(async () => null) }));
    jest.doMock('../../services/appForeground', () => ({ settleForegroundForMic: jest.fn(async () => 'active'), micMayBeRefusedNow: jest.fn(() => false) }));
    jest.doMock('../../services/voiceWarmup', () => ({ abortVoiceWarmup: jest.fn() }));
    jest.doMock('../../services/userTurnClock', () => ({ noteUserTurn: jest.fn(), getUserTurnEpoch: jest.fn(() => 1) }));
    jest.doMock('../../services/funnelEvents', () => ({ noteCaddieTurn: jest.fn() }));
    jest.doMock('../../services/featureAccess', () => ({ takeCaddiePaywallBlock: jest.fn(() => null), CADDIE_PAYWALL_DEFERRED_LINE: 'deferred' }));
    jest.doMock('../../services/dialogEngine', () => ({ getDialog: jest.fn(() => 'Go ahead.') }));
    jest.doMock('../../services/trustLevelService', () => ({ getTrustLevel: jest.fn(() => 2) }));
    jest.doMock('../../store/roundStore', () => ({ useRoundStore: { getState: () => ({ isRoundActive: false, activeCourse: null, currentHole: 1, shots: [], getHolesPlayed: () => 0, getTotalScore: () => 0, getScoreVsPar: () => 0 }) } }));
    jest.doMock('../../store/settingsStore', () => ({ useSettingsStore: { getState: () => ({ voiceEnabled: true, language: 'en', voiceGender: 'male', aiProvider: 'gemini', caddiePersonality: 'kevin', autoListenEnabled: false, caddieAssignments: { round: 'kevin', practice: 'kevin', drills: 'kevin', play: 'kevin' } }) } }));
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
    jest.doMock('../../services/caddieFailureReply', () => ({ failureNotice: jest.fn(async () => 'x'), failureNoticeSync: jest.fn(() => 'x'), localAnswer: jest.fn(() => null) }));
    jest.doMock('../../store/listeningSessionStore', () => ({ useListeningSessionStore: { getState: () => ({ setState: jest.fn() }) } }));
    jest.doMock('../../services/offlineVoiceCache', () => ({ resolveCachedOfflineClipUri: jest.fn(() => null) }));
    jest.doMock('../../services/voice/conversationalToolDispatch', () => ({ dispatchConversationalToolActions: jest.fn() }));
    (globalThis as { fetch?: unknown }).fetch = jest.fn(async () => { throw new Error('offline in test'); });

    const ls = require('../../services/listeningSession') as typeof import('../../services/listeningSession');
    try {
      void ls.toggle();                 // the open tap
      await flush();
      expect(ls.getSessionState()).toBe('opening');
      clock += 1_500;                   // a real second press — well past any echo
      void ls.toggle();
      await flush();
      expect(order).not.toContain('endCaptureEarly'); // queued, not applied to a recorder that is not there
      releaseCue();                     // the cue ends, the mic opens
      await flush(60);
      // The press reaches the capture AFTER the capture has claimed the mic.
      expect(order.indexOf('endCaptureEarly')).toBeGreaterThan(order.indexOf('capture'));
      // ...and it is honoured as an "I'm done": the persona "Got it" cue, not the silence-ended ack.
      expect(order).toContain('gotit_cue');
      expect(deviceAcks).toHaveLength(0);
    } finally {
      ls.forceCloseSession();
      Date.now = realNow;
    }
  });
});
