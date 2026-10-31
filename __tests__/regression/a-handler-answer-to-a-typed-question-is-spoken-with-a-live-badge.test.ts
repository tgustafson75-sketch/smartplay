/**
 * 2026-10-31 (caddie-voice CV-B / caddie-voice-1) — A TYPED QUESTION A LOCAL HANDLER ANSWERS IS COUNTED AS SPEECH.
 *
 * The typed-answer branch that reads a handler's voice_response (e.g. "open SmartFinder", a yardage lookup
 * answered from device state) spoke the line with `void speak(...)`: no replyIsSpeaking(), no await. The turn
 * then ended while the line was still playing, the store went 'idle', and a tap opened a live mic over the
 * answer instead of shushing it. Every other typed speech branch counts the reply and awaits it.
 *
 * Driven on the real listeningSession and the real store, with the handler's answer held open by the test.
 */
import { micTapLook } from '../../services/voice/tapIsDroppedIn';
import { autoListenMayHoldMic } from '../../services/voice/autoListenGate';

jest.setTimeout(120_000);
const flush = async (n = 30) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const until = async (cond: () => boolean) => {
  for (let i = 0; i < 500 && !cond(); i++) await new Promise((r) => setTimeout(r, 5));
};

describe('a typed question a local handler answers keeps the mic live while it is spoken', () => {
  it('reads responding while the handler answer plays, and a tap shushes it instead of opening a mic', async () => {
    jest.resetModules();
    const order: string[] = [];
    const spoken: string[] = [];
    let releaseSpeech: () => void = () => {};
    jest.doMock('../../services/voiceService', () => ({
      speak: jest.fn((text: string) => { spoken.push(text); return new Promise<void>((r) => { releaseSpeech = r; }); }),
      speakFromBase64: jest.fn(async () => undefined),
      stopSpeaking: jest.fn(async () => { releaseSpeech(); }),
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
    // The local precheck recognises the question and the handler answers it from device state — no brain turn.
    jest.doMock('../../services/intents', () => ({
      voiceCommandRouter: {
        getHandler: jest.fn(() => ({})),
        dispatch: jest.fn(async () => ({ success: true, voice_response: 'Opening SmartFinder.' })),
      },
    }));
    jest.doMock('../../services/earbudControl', () => ({ subscribeEarbudTap: jest.fn(() => () => undefined) }));
    jest.doMock('../../services/smartMotionRecordBus', () => ({ isSmartMotionRecording: jest.fn(() => false), emitSmartMotionCommand: jest.fn() }));
    jest.doMock('../../services/responseRouter', () => ({ routeQuery: jest.fn(() => ({ filler: null })) }));
    jest.doMock('../../services/activeSurfaceRegistry', () => ({ getActiveSurface: jest.fn(() => 'caddie') }));
    jest.doMock('../../services/localIntentPrecheck', () => ({ precheckLocalIntent: jest.fn(() => ({ intent_type: 'open_tool', confidence: 'high', raw_text: 'open SmartFinder', language: 'en' })) }));
    jest.doMock('../../services/pendingDisambiguation', () => ({ resolvePendingCourseUtterance: jest.fn(() => null) }));
    jest.doMock('../../store/voiceHitRateStore', () => ({ useVoiceHitRateStore: { getState: () => ({ recordLocal: jest.fn(), recordCloud: jest.fn() }) } }));
    jest.doMock('../../services/apiBase', () => ({ getApiBaseUrl: () => 'http://localhost:9', isEndpointWarmed: () => true, markEndpointWarmed: jest.fn() }));
    jest.doMock('../../services/pendingPuttAsk', () => ({ tryAnswerOpenQuestion: jest.fn(() => null) }));
    jest.doMock('../../store/flagStore', () => ({ isFlagEnabled: jest.fn(() => true) }));
    jest.doMock('../../services/adviceFreshness', () => ({ adviceIsStillWorthSaying: jest.fn(() => true), captureShotEpoch: jest.fn(() => null), currentTurnEpoch: jest.fn(() => null) }));
    jest.doMock('../../services/caddieFailureReply', () => ({ failureNotice: jest.fn(async () => 'x'), failureNoticeSync: jest.fn(() => 'x'), localAnswer: jest.fn(() => null) }));
    jest.doMock('../../services/offlineVoiceCache', () => ({ resolveCachedOfflineClipUri: jest.fn(() => null) }));
    jest.doMock('../../services/voice/conversationalToolDispatch', () => ({ dispatchConversationalToolActions: jest.fn() }));
    (globalThis as { fetch?: unknown }).fetch = jest.fn(() => Promise.reject(new Error('offline in test')));

    const ls = require('../../services/listeningSession') as typeof import('../../services/listeningSession');
    const vs = require('../../services/voiceService') as { stopSpeaking: jest.Mock };
    const { useListeningSessionStore } = require('../../store/listeningSessionStore') as typeof import('../../store/listeningSessionStore');

    const typed = ls.handleTranscribedUtterance('open SmartFinder');
    await until(() => spoken.length > 0);
    await flush();
    expect(spoken).toEqual(['Opening SmartFinder.']);

    // The handler's answer is being spoken: the store says so, and the mic is not dimmed.
    expect(useListeningSessionStore.getState().state).toBe('responding');
    expect(micTapLook(useListeningSessionStore.getState().state)).toEqual({ opacity: 1, dropped: false });
    // The auto-listen recorder gates on the same store, so it cannot arm over the caddie's own line.
    expect(autoListenMayHoldMic({
      autoListen: true, localMode: false, roundActive: true, appActive: true, smartMotion: false,
      tabVoiceState: 'idle', sessionState: useListeningSessionStore.getState().state, vadOwnsTurn: false,
    })).toBe(false);

    // The player taps while the answer plays. It shushes the speech; no mic opens over it.
    void ls.toggle();
    await flush();
    expect(vs.stopSpeaking).toHaveBeenLastCalledWith('screen:services-listeningsession');
    expect(order).not.toContain('open_cue');
    expect(order).not.toContain('capture');
    expect(ls.getSessionState()).toBe('idle');

    // With the speech cut, the turn ends and the shared state is released.
    await typed.catch(() => undefined);
    await flush();
    expect(useListeningSessionStore.getState().state).toBe('idle');
  });
});
