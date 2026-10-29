/**
 * 2026-10-28 (recheck VOICE-ENG-R2-2) — A REFUSED MICROPHONE GOT AN INVITATION, THEN SILENCE.
 *
 * With the mic permission permanently denied (iOS after one "Don't Allow", Android after "Don't allow
 * again"), an earbud press or a badge tap played the go-ahead cue ("What's on your mind?"), then
 * captureUtterance's request came back refused at once with no dialog — bail 'no_permission', which
 * captureBail maps to 'silent' because it assumes an OS prompt is on screen. The caddie invited the
 * player to talk and then said nothing, on every press, with no caption and nothing logged.
 *
 * Driven through the real listeningSession and the real voicePermissionService; expo-av's permission
 * read, the audio and the brain are stubbed.
 */
import { CADDIE_NOTICE_MIC_OFF } from '../../services/caddieAckLines';

const mockPerm: { read: () => Promise<{ granted: boolean; canAskAgain: boolean }> } = {
  read: async () => ({ granted: true, canAskAgain: true }),
};
const mockOrder: string[] = [];
const mockNotices: string[] = [];
const mockCaptions: string[] = [];
const mockHints = { mic_permission_denied: false, setMicDenied: jest.fn(), setMicGranted: jest.fn() };

jest.mock('expo-av', () => ({
  __esModule: true,
  Audio: { getPermissionsAsync: () => mockPerm.read() },
}));
jest.mock('../../store/voiceHintsStore', () => ({ useVoiceHintsStore: { getState: () => mockHints } }));
jest.mock('../../services/voiceService', () => ({
  speak: jest.fn(async () => undefined),
  speakFromBase64: jest.fn(async () => undefined),
  stopSpeaking: jest.fn(async () => undefined),
  captureUtteranceDetailed: jest.fn(async () => {
    mockOrder.push('capture');
    return { text: null, bail: 'no_permission', heardSpeech: false, durationMs: null };
  }),
  releaseExternalMic: jest.fn(async () => 'none'),
  playLocalFile: jest.fn(async () => { mockOrder.push('cue'); }),
  stopCapture: jest.fn(async () => undefined),
  endCaptureEarly: jest.fn(),
  flashCaption: jest.fn((t: string) => { mockCaptions.push(t); }),
  getLastSpokenLine: jest.fn(() => null),
  isCapturing: jest.fn(() => false),
  isExternalMicActive: jest.fn(() => false),
  speakDeviceNotice: jest.fn(async (t: string) => { mockNotices.push(t); }),
  isSpeaking: jest.fn(() => false),
  isSpeakingUserInitiated: jest.fn(() => false),
  getCaptionSeq: jest.fn(() => 0),
  activeVoice: jest.fn(() => ({ persona: 'kevin', gender: 'male' })),
}));
jest.mock('../../services/voiceErrorLog', () => ({ logVoiceSilentFail: jest.fn(), logVoiceDiag: jest.fn(), describeError: String }));
jest.mock('../../services/voice/turnAnswerWatch', () => ({ noteTurnState: jest.fn(), noteTurnIntent: jest.fn(), noteTurnClosing: jest.fn(), noteTurnActed: jest.fn() }));
jest.mock('../../services/conversationalBrain', () => ({ conversationalBrainTurn: jest.fn(async () => ({ text: null, audioBase64: null, toolActions: [] })) }));
jest.mock('../../services/caddieBrain', () => ({ askCaddie: jest.fn(async () => null) }));
jest.mock('../../services/appForeground', () => ({ settleForegroundForMic: jest.fn(async () => 'active'), micMayBeRefusedNow: jest.fn(() => false) }));
jest.mock('../../services/voiceWarmup', () => ({ abortVoiceWarmup: jest.fn() }));
jest.mock('../../services/userTurnClock', () => ({ noteUserTurn: jest.fn(), getUserTurnEpoch: jest.fn(() => 1) }));
jest.mock('../../services/funnelEvents', () => ({ noteCaddieTurn: jest.fn() }));
jest.mock('../../services/featureAccess', () => ({ takeCaddiePaywallBlock: jest.fn(() => null), CADDIE_PAYWALL_DEFERRED_LINE: 'deferred' }));
jest.mock('../../services/dialogEngine', () => ({ getDialog: jest.fn(() => "What's on your mind?") }));
jest.mock('../../services/trustLevelService', () => ({ getTrustLevel: jest.fn(() => 2) }));
jest.mock('../../store/roundStore', () => ({ useRoundStore: { getState: () => ({ isRoundActive: false, activeCourse: null, currentHole: 1, shots: [], getHolesPlayed: () => 0, getTotalScore: () => 0, getScoreVsPar: () => 0 }) } }));
jest.mock('../../store/settingsStore', () => ({ useSettingsStore: { getState: () => ({ voiceEnabled: true, language: 'en', voiceGender: 'male', aiProvider: 'gemini', caddiePersonality: 'kevin', autoListenEnabled: false, caddieAssignments: { round: 'kevin', practice: 'kevin', drills: 'kevin', play: 'kevin' } }) } }));
jest.mock('../../services/intents', () => ({ voiceCommandRouter: { getHandler: jest.fn(() => null) } }));
jest.mock('../../services/earbudControl', () => ({ subscribeEarbudTap: jest.fn(() => () => undefined) }));
jest.mock('../../services/smartMotionRecordBus', () => ({ isSmartMotionRecording: jest.fn(() => false), emitSmartMotionCommand: jest.fn() }));
jest.mock('../../services/responseRouter', () => ({ routeQuery: jest.fn(() => ({ filler: null })) }));
jest.mock('../../services/activeSurfaceRegistry', () => ({ getActiveSurface: jest.fn(() => 'caddie') }));
jest.mock('../../services/localIntentPrecheck', () => ({ precheckLocalIntent: jest.fn(() => null) }));
jest.mock('../../services/pendingDisambiguation', () => ({ resolvePendingCourseUtterance: jest.fn(() => null) }));
jest.mock('../../store/voiceHitRateStore', () => ({ useVoiceHitRateStore: { getState: () => ({ recordLocal: jest.fn(), recordCloud: jest.fn() }) } }));
jest.mock('../../services/apiBase', () => ({ getApiBaseUrl: () => 'http://localhost:9', isEndpointWarmed: () => true, markEndpointWarmed: jest.fn() }));
jest.mock('../../services/pendingPuttAsk', () => ({ tryAnswerOpenQuestion: jest.fn(() => null) }));
jest.mock('../../store/flagStore', () => ({ isFlagEnabled: jest.fn(() => true) }));
jest.mock('../../services/adviceFreshness', () => ({ adviceIsStillWorthSaying: jest.fn(() => true), captureShotEpoch: jest.fn(() => null), currentTurnEpoch: jest.fn(() => null) }));
jest.mock('../../services/caddieFailureReply', () => ({ failureNotice: jest.fn(async () => 'x'), failureNoticeSync: jest.fn(() => 'x'), localAnswer: jest.fn(() => null) }));
jest.mock('../../store/listeningSessionStore', () => ({ useListeningSessionStore: { getState: () => ({ setState: jest.fn() }) } }));
jest.mock('../../services/offlineVoiceCache', () => ({ resolveCachedOfflineClipUri: jest.fn(() => null) }));
jest.mock('../../services/voice/conversationalToolDispatch', () => ({ dispatchConversationalToolActions: jest.fn() }));

jest.setTimeout(60_000);
const flush = async (n = 80) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
type LS = typeof import('../../services/listeningSession');
const vlog = () => require('../../services/voiceErrorLog') as { logVoiceSilentFail: jest.Mock; logVoiceDiag: jest.Mock };

let ls: LS;
beforeEach(() => {
  mockOrder.length = 0; mockNotices.length = 0; mockCaptions.length = 0;
  mockHints.mic_permission_denied = false;
  mockHints.setMicDenied.mockClear(); mockHints.setMicGranted.mockClear();
  vlog().logVoiceDiag.mockClear(); vlog().logVoiceSilentFail.mockClear();
  (globalThis as { fetch?: unknown }).fetch = jest.fn(async () => { throw new Error('offline in test'); });
  ls = require('../../services/listeningSession') as LS;
});
afterEach(() => { ls.forceCloseSession(); });

describe('a press with the microphone permanently refused', () => {
  it('skips the go-ahead cue, says where to turn the mic on, logs it and goes idle', async () => {
    mockPerm.read = async () => ({ granted: false, canAskAgain: false });
    void ls.toggle();
    await flush();
    expect(mockOrder).toEqual([]);                                   // no invitation, no capture
    expect(mockNotices).toEqual([CADDIE_NOTICE_MIC_OFF.en]);          // spoken
    expect(mockCaptions).toContain(CADDIE_NOTICE_MIC_OFF.en);         // and on screen
    expect(vlog().logVoiceDiag.mock.calls.some((c) => c[0] === 'mic_permission_blocked')).toBe(true);
    expect(mockHints.setMicDenied).toHaveBeenCalledWith(true);        // the rest of the app knows
    expect(ls.getSessionState()).toBe('idle');
  });

  it('every press says it — not only the first', async () => {
    mockPerm.read = async () => ({ granted: false, canAskAgain: false });
    void ls.toggle(); await flush();
    expect(ls.getSessionState()).toBe('idle');
    void ls.toggle(); await flush();
    expect(mockNotices).toEqual([CADDIE_NOTICE_MIC_OFF.en, CADDIE_NOTICE_MIC_OFF.en]);
    expect(mockOrder).toEqual([]);
  });
});

describe('a mic the OS can still ask about is left to the real dialog', () => {
  it('undetermined: cue, then the capture (whose request shows the prompt) — no mic-off line', async () => {
    mockPerm.read = async () => ({ granted: false, canAskAgain: true });
    void ls.toggle();
    await flush();
    expect(mockOrder).toEqual(['cue', 'capture']);
    expect(mockNotices).not.toContain(CADDIE_NOTICE_MIC_OFF.en);
  });

  it('a permission read that throws fails open: the mic is tried as before', async () => {
    mockPerm.read = async () => { throw new Error('native module unavailable'); };
    void ls.toggle();
    await flush();
    expect(mockOrder).toEqual(['cue', 'capture']);
  });

  it('granted clears a stale denial flag', async () => {
    mockHints.mic_permission_denied = true;
    mockPerm.read = async () => ({ granted: true, canAskAgain: true });
    void ls.toggle();
    await flush();
    expect(mockHints.setMicGranted).toHaveBeenCalled();
    expect(mockOrder).toEqual(['cue', 'capture']);
  });
});

describe('the mic-off line exists in every language and is its own line', () => {
  it('is non-empty and points at Settings', () => {
    for (const lang of ['en', 'es', 'zh'] as const) expect(CADDIE_NOTICE_MIC_OFF[lang].trim().length).toBeGreaterThan(0);
    expect(CADDIE_NOTICE_MIC_OFF.en).toMatch(/Settings/);
  });

  it('is pre-rendered in the persona voice, like the other mic notices', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../services/offlineVoiceCache.ts'), 'utf8') as string;
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).toMatch(/CADDIE_NOTICE_MIC_OFF\[language\]/);
  });
});
