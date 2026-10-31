/**
 * 2026-10-30 (recheck round 4, caddie-voice-1 and caddie-voice-test-1) — A TAP ON THE MIC WHILE A
 * TYPED TURN IS STILL BEING ANSWERED.
 *
 * handleTranscribedUtterance (the bottom bar's send, and the watch) drives only the shared listening
 * store to 'thinking'. It never raises sessionInFlight, so toggle()'s in-flight guard passed a tap and
 * opened a mic over the answer still coming back — while the header badge and the bottom-bar mic, which
 * read that same store through micTapLook, dimmed to 40% and said "Your caddie is thinking". The dim
 * lied on the typed path, and the rule "'thinking' is dropped" held only for voice turns.
 *
 * Driven on the real listeningSession and the real store: a typed turn held open at its classifier,
 * then a tap through toggle(). The tap must be dropped, and the dim must say so.
 */
import { micTapLook } from '../../services/voice/tapIsDroppedIn';

jest.setTimeout(120_000);
const flush = async (n = 30) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

describe('a tap on the mic while a typed turn is still being answered', () => {
  it('is dropped the way a voice turn is dropped, and the dim on the mic says so', async () => {
    jest.resetModules();
    const order: string[] = [];
    let releaseClassifier: (reason: Error) => void = () => {};
    jest.doMock('../../services/voiceService', () => ({
      speak: jest.fn(async () => undefined),
      speakFromBase64: jest.fn(async () => undefined),
      stopSpeaking: jest.fn(async () => undefined),
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
      speakDeviceNotice: jest.fn(async () => undefined),
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
    jest.doMock('../../services/offlineVoiceCache', () => ({ resolveCachedOfflineClipUri: jest.fn(() => null) }));
    jest.doMock('../../services/voice/conversationalToolDispatch', () => ({ dispatchConversationalToolActions: jest.fn() }));
    // The typed turn is held at its classifier until the test lets it go, so it is genuinely in flight.
    // Any later network call fails at once, so the turn can finish its fallback once released.
    let calls = 0;
    (globalThis as { fetch?: unknown }).fetch = jest.fn(() => {
      calls += 1;
      if (calls > 1) return Promise.reject(new Error('offline in test'));
      return new Promise<Response>((_res, rej) => { releaseClassifier = rej; });
    });

    const ls = require('../../services/listeningSession') as typeof import('../../services/listeningSession');
    const { useListeningSessionStore } = require('../../store/listeningSessionStore') as typeof import('../../store/listeningSessionStore');

    const typed = ls.handleTranscribedUtterance('how far to the green');
    await flush();
    // The typed turn is in flight: the shared store says so, and the mic dims for it.
    expect(useListeningSessionStore.getState().state).toBe('thinking');
    expect(micTapLook(useListeningSessionStore.getState().state)).toEqual({ opacity: 0.4, dropped: true });

    // A second typed turn starts and finishes while the first is still answering. Its end must not
    // clear the shared state the first turn still holds.
    await ls.handleTranscribedUtterance('and the wind').catch(() => undefined);
    await flush();
    expect(useListeningSessionStore.getState().state).toBe('thinking');

    // The player taps the mic while the answer is still coming back. The tap is dropped: no open cue,
    // no capture, and the session never leaves idle.
    void ls.toggle();
    await flush();
    expect(order).not.toContain('open_cue');
    expect(order).not.toContain('capture');
    expect(ls.getSessionState()).toBe('idle');

    releaseClassifier(new Error('released by test'));
    await typed.catch(() => undefined);
    await flush();
    // The last typed turn to finish clears the shared state, so a later tap is not dropped.
    expect(useListeningSessionStore.getState().state).toBe('idle');
  });
});
