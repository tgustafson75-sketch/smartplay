/**
 * 2026-10-31 (caddie-home CAD-HOME-2) — A TAP THAT ENDS THE PLAYER'S OWN HELD UTTERANCE.
 *
 * With Active Listening on, the VAD recorder holds the mic while the player is mid-sentence and reports
 * itself as a holder. toggle() refused every tap in that state as "mic held elsewhere", so the tap that
 * was meant as the sentence's endpoint buzzed and did nothing, and the sentence ran on to the 18 s ceiling
 * (or to a silence the wind never gave). The tap is now the endpoint: the utterance's own owner submits
 * it. A screen that holds the mic for another reason still owns the tap.
 *
 * Driven on the real listeningSession with the mic registry stood in for voiceService, so each owner's
 * answer is set by the test. The VAD side is pinned to the hook that registers it.
 */
import fs from 'fs';
import path from 'path';

jest.setTimeout(120_000);
const flush = async (n = 30) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

type Holder = { active: boolean; endable: boolean; endVerdict: 'submitted' | 'discarded' };

function load(holder: Holder) {
  jest.resetModules();
  const order: string[] = [];
  const logSilent = jest.fn();
  const logDiag = jest.fn();
  jest.doMock('../../services/voiceService', () => ({
    speak: jest.fn(async () => undefined),
    speakFromBase64: jest.fn(async () => undefined),
    stopSpeaking: jest.fn(async () => undefined),
    captureUtteranceDetailed: jest.fn(async () => {
      order.push('capture');
      return { text: '', bail: 'silence', heardSpeech: false, durationMs: 0 };
    }),
    releaseExternalMic: jest.fn(async () => 'none'),
    endHeldUtterance: jest.fn(async () => {
      if (!holder.endable) return 'none';
      holder.active = false;
      return holder.endVerdict;
    }),
    playLocalFile: jest.fn(async () => { order.push('open_cue'); }),
    stopCapture: jest.fn(async () => undefined),
    endCaptureEarly: jest.fn(() => undefined),
    flashCaption: jest.fn(),
    getLastSpokenLine: jest.fn(() => null),
    isCapturing: jest.fn(() => false),
    isExternalMicActive: jest.fn(() => holder.active),
    speakDeviceNotice: jest.fn(async () => undefined),
    isSpeaking: jest.fn(() => false),
    isSpeakingUserInitiated: jest.fn(() => false),
    getCaptionSeq: jest.fn(() => 0),
    activeVoice: jest.fn(() => ({ persona: 'kevin', gender: 'male' })),
  }));
  jest.doMock('../../services/voiceErrorLog', () => ({ logVoiceSilentFail: logSilent, logVoiceDiag: logDiag, describeError: String }));
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
  jest.doMock('../../store/settingsStore', () => ({ useSettingsStore: { getState: () => ({ voiceEnabled: true, language: 'en', voiceGender: 'male', aiProvider: 'gemini', caddiePersonality: 'kevin', autoListenEnabled: true, caddieAssignments: { round: 'kevin', practice: 'kevin', drills: 'kevin', play: 'kevin' } }) } }));
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
  const ls = require('../../services/listeningSession') as typeof import('../../services/listeningSession');
  const voice = require('../../services/voiceService') as { endHeldUtterance: jest.Mock };
  return { ls, order, logSilent, logDiag, voice };
}

describe('a tap while the player is mid-utterance ends it, and a screen that holds the mic still owns the tap', () => {
  afterEach(() => { jest.resetModules(); jest.clearAllMocks(); });

  it('THE BUG: the VAD holds the sentence, the tap submits it, and no second turn or swallowed-tap report follows', async () => {
    const holder: Holder = { active: true, endable: true, endVerdict: 'submitted' };
    const env = load(holder);
    await env.ls.toggle();
    await flush();
    expect(env.voice.endHeldUtterance).toHaveBeenCalledTimes(1);
    expect(env.order).not.toContain('open_cue');
    expect(env.order).not.toContain('capture');
    expect(env.logSilent).not.toHaveBeenCalledWith('tap_swallowed', expect.anything());
    expect(env.logDiag).toHaveBeenCalledWith('tap_ended_utterance', expect.anything());
    expect(env.ls.getSessionState()).toBe('idle');
  });

  it('the VAD heard nothing and discarded its capture: the mic is free, so the tap opens a turn', async () => {
    const holder: Holder = { active: true, endable: true, endVerdict: 'discarded' };
    const env = load(holder);
    await env.ls.toggle();
    await flush(60);
    expect(env.voice.endHeldUtterance).toHaveBeenCalledTimes(1);
    expect(env.order).toContain('open_cue');
  });

  it('control: a screen that holds the mic for another reason still owns the tap (buzz, no endpoint, no turn)', async () => {
    const holder: Holder = { active: true, endable: false, endVerdict: 'submitted' };
    const env = load(holder);
    await env.ls.toggle();
    await flush();
    expect(env.voice.endHeldUtterance).toHaveBeenCalledTimes(1);
    expect(env.logSilent).toHaveBeenCalledWith('tap_swallowed', expect.objectContaining({ guard: 'mic_held_elsewhere' }));
    expect(env.order).not.toContain('open_cue');
    expect(env.order).not.toContain('capture');
  });

  it('the VAD hook registers its utterance as the tap endpoint (the wiring the tap depends on)', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../hooks/useVoiceActivityDetection.ts'), 'utf8');
    expect(src).toMatch(/registerUtteranceEndpoint\(endUtterance\)/);
  });
});
