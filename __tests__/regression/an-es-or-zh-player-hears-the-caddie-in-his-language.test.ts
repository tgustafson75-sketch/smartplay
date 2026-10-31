/**
 * 2026-10-31 (caddie-voice-3) — AN ES OR ZH PLAYER HEARS THE EARBUD OPENER AND GOT-IT CUE IN HIS LANGUAGE.
 *
 * The earbud tap spoke pickOpener() (English dialog templates only) and the got-it cue (English GOTIT_CUES
 * only), so a Spanish or Chinese player heard the caddie open and close in English on every tap. The fix
 * gives both an es and a zh set, pre-renders those lines in the caddie's voice (offlineVoiceCache), and has
 * the tap pick from the player's language.
 *
 * Three layers: the per-language data is well formed, every es/zh line is one the offline cache renders, and a
 * real tap with language 'es' asks the cache for a Spanish clip.
 */
import { EARBUD_OPEN_BY_LANG, GOTIT_CUES_BY_LANG, TRUST_L1_OPENER_BY_LANG } from '../../services/caddieAckLines';
import { _allCaddieTemplates } from '../../constants/dialogTemplates/caddieTemplates';
import { _allCoachTemplates } from '../../constants/dialogTemplates/coachTemplates';
import { _allPsychologistTemplates } from '../../constants/dialogTemplates/psychologistTemplates';

jest.setTimeout(120_000);
const flush = async (n = 30) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

const ROLES = ['caddie', 'coach', 'psychologist'] as const;
const englishOpeners = new Set<string>([
  ..._allCaddieTemplates().earbud_open,
  ..._allCoachTemplates().earbud_open,
  ..._allPsychologistTemplates().earbud_open,
]);

describe('the earbud opener and got-it cue are in the player\'s language', () => {
  it('every es and zh set is non-empty, has no blanks, and is not the English wording', () => {
    for (const lang of ['es', 'zh'] as const) {
      expect(GOTIT_CUES_BY_LANG[lang].length).toBeGreaterThan(0);
      for (const line of GOTIT_CUES_BY_LANG[lang]) {
        expect(line.trim().length).toBeGreaterThan(0);
        expect(englishOpeners.has(line)).toBe(false);
      }
      for (const role of ROLES) {
        expect(EARBUD_OPEN_BY_LANG[lang][role].length).toBeGreaterThan(0);
        for (const line of EARBUD_OPEN_BY_LANG[lang][role]) {
          expect(line.trim().length).toBeGreaterThan(0);
          expect(englishOpeners.has(line)).toBe(false);
        }
      }
      expect(TRUST_L1_OPENER_BY_LANG[lang]).not.toBe(TRUST_L1_OPENER_BY_LANG.en);
    }
    expect(EARBUD_OPEN_BY_LANG.zh.caddie.every((l) => /[一-鿿]/.test(l))).toBe(true);
    expect(GOTIT_CUES_BY_LANG.zh.every((l) => /[一-鿿]/.test(l))).toBe(true);
  });

  it('every es and zh line is pre-rendered by the offline cache, so its clip resolves in that language', async () => {
    jest.resetModules();
    jest.doMock('expo-file-system', () => ({
      File: class { exists = false; size = 0; constructor(..._args: unknown[]) {} },
      Paths: { cache: '/tmp/cache' },
    }));
    const cache = require('../../services/offlineVoiceCache') as typeof import('../../services/offlineVoiceCache');
    const cached = new Set(cache.OFFLINE_LINES.filter((l) => l.language !== 'en').map((l) => `${l.language}:${l.text}`));

    for (const lang of ['es', 'zh'] as const) {
      for (const line of GOTIT_CUES_BY_LANG[lang]) expect(cached.has(`${lang}:${line}`)).toBe(true);
      for (const role of ROLES) {
        for (const line of EARBUD_OPEN_BY_LANG[lang][role]) expect(cached.has(`${lang}:${line}`)).toBe(true);
      }
      expect(cached.has(`${lang}:${TRUST_L1_OPENER_BY_LANG[lang]}`)).toBe(true);
    }
  });

  it('a tap with the player set to Spanish asks the cache for a Spanish opener', async () => {
    jest.resetModules();
    const resolved: string[] = [];
    jest.doMock('../../services/voiceService', () => ({
      speak: jest.fn(async () => undefined),
      speakFromBase64: jest.fn(async () => undefined),
      stopSpeaking: jest.fn(async () => undefined),
      captureUtteranceDetailed: jest.fn(async () => ({ text: '', bail: 'silence', heardSpeech: false, durationMs: 0 })),
      releaseExternalMic: jest.fn(async () => 'none'),
      playLocalFile: jest.fn(async () => undefined),
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
    jest.doMock('../../services/offlineVoiceCache', () => ({
      resolveCachedOfflineClipUri: jest.fn((text: string) => { resolved.push(text); return 'file:///cached/opener.mp3'; }),
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
    jest.doMock('../../services/trustLevelService', () => ({ getTrustLevel: jest.fn(() => 2) }));
    jest.doMock('../../store/roundStore', () => ({ useRoundStore: { getState: () => ({ isRoundActive: false, activeCourse: null, currentHole: 1, shots: [], getHolesPlayed: () => 0, getTotalScore: () => 0, getScoreVsPar: () => 0 }) } }));
    jest.doMock('../../store/settingsStore', () => ({ useSettingsStore: { getState: () => ({ voiceEnabled: true, language: 'es', voiceGender: 'male', aiProvider: 'gemini', caddiePersonality: 'kevin', autoListenEnabled: false, caddieAssignments: { round: 'kevin', practice: 'kevin', drills: 'kevin', play: 'kevin' } }) } }));
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
    jest.doMock('../../services/voice/conversationalToolDispatch', () => ({ dispatchConversationalToolActions: jest.fn() }));
    (globalThis as { fetch?: unknown }).fetch = jest.fn(() => Promise.reject(new Error('offline in test')));

    const ls = require('../../services/listeningSession') as typeof import('../../services/listeningSession');

    void ls.toggle();
    await flush(120);

    // The opener is the first cue the tap asks the cache for. Off-course (no active round) the role is the coach.
    expect(resolved.length).toBeGreaterThan(0);
    expect(EARBUD_OPEN_BY_LANG.es.coach).toContain(resolved[0]);
    expect(englishOpeners.has(resolved[0])).toBe(false);
  });
});
