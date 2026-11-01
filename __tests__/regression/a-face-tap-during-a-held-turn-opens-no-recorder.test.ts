/**
 * 2026-10-31 (caddie-voice CAD-VOICE-3, recheck round 5) — A FACE TAP WHILE A HELD TURN IS ANSWERING.
 *
 * The player types "how far to the pin?" in the bottom bar. handleTranscribedUtterance holds the turn
 * (typedTurnsInFlight = 1, the shared store reads 'thinking') but never raises sessionInFlight, so the
 * face's route read the state as "no session" and returned 'tab'. The tab's tap-to-talk then started a
 * recorder over the answer still coming back, and the reply spoke over that open mic.
 *
 * Driven on the real listeningSession: a typed turn held open at its classifier, then the face route the
 * way handleMicPress computes it. The face must hand the tap to toggle(), and toggle() must open nothing.
 */
import fs from 'fs';
import path from 'path';
import { avatarTapRoute } from '../../services/voice/tapIsDroppedIn';

jest.setTimeout(120_000);
const flush = async (n = 30) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

describe('a face tap while a held turn is still answering', () => {
  it('routes to the session, so the face never falls through to the tab recorder', () => {
    // Pure route table: a held turn with the session idle is a session, not the tab's own tap-to-talk.
    expect(avatarTapRoute('idle', false, true)).toBe('session');
    expect(avatarTapRoute('idle', true, true)).toBe('session');
    // The existing rules are unchanged when no held turn is in flight.
    expect(avatarTapRoute('idle', false, false)).toBe('tab');
    expect(avatarTapRoute('idle', true, false)).toBe('force_close');
  });

  it('is dropped by toggle() on the real session, and opens no cue or capture', async () => {
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
    jest.doMock('../../store/roundStore', () => ({ useRoundStore: { getState: () => ({ isRoundActive: false, activeCourse: null, currentHole: 1, club: null, shots: [], getHolesPlayed: () => 0, getTotalScore: () => 0, getScoreVsPar: () => 0 }) } }));
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
    let calls = 0;
    (globalThis as { fetch?: unknown }).fetch = jest.fn(() => {
      calls += 1;
      if (calls > 1) return Promise.reject(new Error('offline in test'));
      return new Promise<Response>((_res, rej) => { releaseClassifier = rej; });
    });

    const ls = require('../../services/listeningSession') as typeof import('../../services/listeningSession');
    const typed = ls.handleTranscribedUtterance('how far to the pin');
    await flush();
    expect(ls.isHeldTurnInFlight()).toBe(true);
    expect(ls.isSessionInFlight()).toBe(false);

    // The face's route, computed exactly as handleMicPress computes it.
    const route = ls.avatarTapRoute(ls.getSessionState(), ls.isSessionInFlight(), ls.isHeldTurnInFlight());
    expect(route).toBe('session');

    // The route hands the tap to toggle(), which drops it: no open cue, no capture, and no session opened.
    void ls.toggle();
    await flush();
    expect(order).not.toContain('open_cue');
    expect(order).not.toContain('capture');
    expect(ls.getSessionState()).toBe('idle');

    releaseClassifier(new Error('released by test'));
    await typed.catch(() => undefined);
    await flush();
    expect(ls.isHeldTurnInFlight()).toBe(false);
  });

  it('is the rule handleMicPress runs', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../hooks/useVoiceCaddie.ts'), 'utf8');
    expect(src).toMatch(/const sessionRoute = avatarTapRoute\(getSessionState\(\), isSessionInFlight\(\), isHeldTurnInFlight\(\)\);/);
  });
});
