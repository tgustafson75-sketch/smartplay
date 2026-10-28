/**
 * 2026-10-28 (Brain review r2) — "SHOULD I PLAY A 7 IRON HERE?" IS A CLUB QUESTION, NOT A SONG.
 *
 * detectPlaySongRequest matched any "play …" outside a short golf list, so the commonest caddie
 * questions there are — "Should I play a 7 iron here?", "How would you play this hole?", "What should
 * I play off the tee?", "Should I play it left or right?" — opened the jukebox with whatever golf
 * video YouTube returned, and the brain never heard the question. Round 1 (B10) put the song portal
 * in front of the earbud, typed and watch brain turns too, so it reached every route used in a round.
 *
 * Drives the REAL listeningSession (typed box / watch and earbud) through the real pre-brain step,
 * with the YouTube search and the router at the device edge.
 */

type Capture = { text: string | null; bail: string | null; heardSpeech: boolean; durationMs: number | null };

const mockState = {
  captures: [] as Capture[],
  spoken: [] as string[],
  brainMessages: [] as string[],
  searches: [] as string[],
  pushes: 0,
};
const noCapture: Capture = { text: null, bail: 'cancelled', heardSpeech: false, durationMs: 0 };

jest.mock('../../services/songPortal', () => ({
  searchSong: jest.fn(async (q: string) => { mockState.searches.push(q); return { videoId: 'abc', title: `Video for ${q}` }; }),
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn(() => { mockState.pushes += 1; }) } }));
jest.mock('../../services/voiceService', () => ({
  speak: jest.fn(async (text: string) => { mockState.spoken.push(text); }),
  speakFromBase64: jest.fn(async (_b: string, o?: { caption?: string }) => { mockState.spoken.push(o?.caption ?? '(audio)'); }),
  stopSpeaking: jest.fn(async () => undefined),
  captureUtteranceDetailed: jest.fn(async () => mockState.captures.shift() ?? noCapture),
  releaseExternalMic: jest.fn(async () => 'none'),
  playLocalFile: jest.fn(async () => undefined),
  stopCapture: jest.fn(async () => undefined),
  endCaptureEarly: jest.fn(),
  flashCaption: jest.fn(),
  getLastSpokenLine: jest.fn(() => null),
  isCapturing: jest.fn(() => false),
  isExternalMicActive: jest.fn(() => false),
  speakDeviceNotice: jest.fn(async (t: string) => { mockState.spoken.push(t); }),
  isSpeaking: jest.fn(() => false),
  isSpeakingUserInitiated: jest.fn(() => false),
  getCaptionSeq: jest.fn(() => 0),
  activeVoice: jest.fn(() => ({ persona: 'kevin', gender: 'male' })),
}));
jest.mock('../../services/voiceErrorLog', () => ({
  logVoiceSilentFail: jest.fn(), logVoiceDiag: jest.fn(), describeError: (e: unknown) => String(e),
}));
jest.mock('../../services/voice/turnAnswerWatch', () => ({
  noteTurnState: jest.fn(), noteTurnIntent: jest.fn(), noteTurnClosing: jest.fn(), noteTurnActed: jest.fn(),
}));
jest.mock('../../services/conversationalBrain', () => ({
  conversationalBrainTurn: jest.fn(async (message: string) => {
    mockState.brainMessages.push(message);
    return { text: 'Smooth 7.', audioBase64: null, toolActions: [] };
  }),
}));
jest.mock('../../services/caddieBrain', () => ({ askCaddie: jest.fn(async () => null) }));
jest.mock('../../services/voiceWarmup', () => ({ abortVoiceWarmup: jest.fn() }));
jest.mock('../../services/userTurnClock', () => ({ noteUserTurn: jest.fn(), getUserTurnEpoch: jest.fn(() => 1) }));
jest.mock('../../services/funnelEvents', () => ({ noteCaddieTurn: jest.fn() }));
jest.mock('../../services/featureAccess', () => ({ takeCaddiePaywallBlock: jest.fn(() => null), CADDIE_PAYWALL_DEFERRED_LINE: 'deferred' }));
jest.mock('../../services/dialogEngine', () => ({ getDialog: jest.fn(() => 'Go ahead.') }));
jest.mock('../../services/trustLevelService', () => ({ getTrustLevel: jest.fn(() => 2) }));
jest.mock('../../store/roundStore', () => ({
  useRoundStore: { getState: () => ({
    isRoundActive: true, activeCourse: null, mode: 'stroke', currentHole: 5, shots: [],
    getHolesPlayed: () => 4, getTotalScore: () => 0, getScoreVsPar: () => 0,
  }) },
}));
jest.mock('../../store/settingsStore', () => ({
  useSettingsStore: { getState: () => ({
    voiceEnabled: true, language: 'en', voiceGender: 'male', aiProvider: 'gemini',
    caddiePersonality: 'kevin', autoListenEnabled: false,
    caddieAssignments: { round: 'kevin', practice: 'kevin', drills: 'kevin', play: 'kevin' },
  }) },
}));
jest.mock('../../services/intents', () => {
  const { VoiceCommandRouter } = jest.requireActual('../../services/voiceCommandRouter');
  return { voiceCommandRouter: new VoiceCommandRouter() };
});
jest.mock('../../services/earbudControl', () => ({ subscribeEarbudTap: jest.fn(() => () => undefined) }));
jest.mock('../../services/responseRouter', () => ({ routeQuery: jest.fn(() => ({ filler: null })) }));
jest.mock('../../services/activeSurfaceRegistry', () => ({ getActiveSurface: jest.fn(() => 'caddie') }));
jest.mock('../../services/pendingDisambiguation', () => ({ resolvePendingCourseUtterance: jest.fn(() => null) }));
jest.mock('../../store/voiceHitRateStore', () => ({ useVoiceHitRateStore: { getState: () => ({ recordLocal: jest.fn(), recordCloud: jest.fn() }) } }));
jest.mock('../../services/apiBase', () => ({
  getApiBaseUrl: () => 'http://localhost:9', isEndpointWarmed: () => true, markEndpointWarmed: jest.fn(),
}));
jest.mock('../../store/flagStore', () => ({ isFlagEnabled: jest.fn(() => true) }));
jest.mock('../../services/adviceFreshness', () => ({
  adviceIsStillWorthSaying: jest.fn(() => true), captureShotEpoch: jest.fn(() => null), currentTurnEpoch: jest.fn(() => null),
}));
jest.mock('../../services/caddieFailureReply', () => ({
  failureNotice: jest.fn(async () => 'FAILURE LINE'),
  failureNoticeSync: jest.fn(() => 'FAILURE LINE'),
  localAnswer: jest.fn(() => null),
}));
jest.mock('../../store/listeningSessionStore', () => ({ useListeningSessionStore: { getState: () => ({ setState: jest.fn() }) } }));
jest.mock('../../services/offlineVoiceCache', () => ({ resolveCachedOfflineClipUri: jest.fn(() => null) }));
jest.mock('../../services/voice/conversationalToolDispatch', () => ({ dispatchConversationalToolActions: jest.fn() }));

import { detectPlaySongRequest } from '../../services/musicIntent';

type LS = typeof import('../../services/listeningSession');
type CS = typeof import('../../services/conversationState');

jest.setTimeout(120_000);

const flush = async (n = 40) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const said = (text: string): Capture => ({ text, bail: null, heardSpeech: true, durationMs: 1500 });

const CLUB_QUESTIONS = [
  'Should I play a 7 iron here?',
  'How would you play this hole?',
  'What should I play off the tee?',
  'Should I play it left or right?',
];

let ls: LS;
let cs: CS;
let realNow: () => number;
let clock = 1_000_000;

beforeEach(() => {
  jest.resetModules();
  Object.assign(mockState, { captures: [], spoken: [], brainMessages: [], searches: [], pushes: 0 });
  realNow = Date.now;
  clock = 1_000_000;
  Date.now = () => clock;
  ls = require('../../services/listeningSession') as LS;
  cs = require('../../services/conversationState') as CS;
  (global as { fetch?: unknown }).fetch = jest.fn(async () => { throw new Error('offline in test'); });
});
afterEach(() => { Date.now = realNow; ls.forceCloseSession(); cs.clearConversation('test end'); });

const typed = async (text: string) => { clock += 5_000; await ls.handleTranscribedUtterance(text); await flush(); };
const earbud = async (text: string) => {
  clock += 5_000;
  mockState.captures.push(said(text));
  await Promise.race([ls.toggle(), new Promise((r) => setTimeout(r, 10_000))]);
  await flush();
};

describe('the detector', () => {
  it('THE BUG: a club question is not a song request', () => {
    for (const q of CLUB_QUESTIONS) expect(detectPlaySongRequest(q)).toBeNull();
  });

  it('nor is a shot decision said as a statement', () => {
    for (const q of ['would you play a 7 here', 'play a draw', "I'd play the wind", 'play it left of the bunker', 'can you play it over the water']) {
      expect(detectPlaySongRequest(q)).toBeNull();
    }
  });

  it('a song request still is — said as a command, or with a music word', () => {
    expect(detectPlaySongRequest('Kevin play Hotel California')?.query).toBe('Hotel California');
    expect(detectPlaySongRequest('hey Kevin, play some music')?.query).toBe('some music');
    expect(detectPlaySongRequest('I want some music, play Thunderstruck')?.query).toBe('Thunderstruck');
    expect(detectPlaySongRequest('play the song Low')?.query).toBe('Low');
  });
});

describe('every round route: the club question reaches the caddie, not YouTube', () => {
  for (const q of CLUB_QUESTIONS) {
    it(`typed / watch: "${q}"`, async () => {
      await typed(q);
      expect(mockState.searches).toEqual([]);
      expect(mockState.pushes).toBe(0);
      expect(mockState.brainMessages).toEqual([q]);
    });

    it(`earbud: "${q}"`, async () => {
      await earbud(q);
      expect(mockState.searches).toEqual([]);
      expect(mockState.brainMessages).toEqual([q]);
      expect(mockState.spoken.some((s) => /Pulling up/.test(s))).toBe(false);
    });
  }

  it('control: "can you play baby shark" still opens the player and never bills a brain turn', async () => {
    await typed('can you play baby shark');
    expect(mockState.searches).toEqual(['baby shark']);
    expect(mockState.pushes).toBe(1);
    expect(mockState.brainMessages).toEqual([]);
  });
});
