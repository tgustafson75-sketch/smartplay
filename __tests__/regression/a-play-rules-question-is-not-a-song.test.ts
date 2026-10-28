/**
 * 2026-10-28 (Brain review r3) — "PLAY IT AS IT LIES?" IS A RULES QUESTION, NOT A SONG.
 *
 * The r2 fix (ac5903b4) let a "play …" sentence through as a song request when it LED with "play", and
 * the golf list it then checked did not know the ball, a lie, a provisional, a local rule or a number
 * word. "Play the ball back in my stance?", "Play it as it lies?", "Play a provisional?", "Play two
 * clubs more?", "Play winter rules?" all searched YouTube, opened the jukebox and said "Pulling up …";
 * the question never reached Kevin. And when the search could not be made at all (offline), the
 * caddie said 'I couldn't find "<song>"' — blaming the title for a dead connection.
 *
 * Drives the REAL listeningSession (typed box / watch and earbud) through the real pre-brain step,
 * with YouTube and the router at the device edge.
 */

type Capture = { text: string | null; bail: string | null; heardSpeech: boolean; durationMs: number | null };

const mockState = {
  captures: [] as Capture[],
  spoken: [] as string[],
  brainMessages: [] as string[],
  searches: [] as string[],
  pushes: 0,
  searchMode: 'match' as 'match' | 'real',
};
const noCapture: Capture = { text: null, bail: 'cancelled', heardSpeech: false, durationMs: 0 };

// 'match' stubs a hit; 'real' runs the real portal against the test's fetch (the device edge).
jest.mock('../../services/songPortal', () => {
  const actual = jest.requireActual('../../services/songPortal');
  return {
    SongSearchUnavailable: actual.SongSearchUnavailable,
    searchSong: jest.fn(async (q: string) => {
      mockState.searches.push(q);
      if (mockState.searchMode === 'real') return actual.searchSong(q);
      return { videoId: 'abc', title: `Video for ${q}` };
    }),
  };
});
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

/** Every one of these returned a song query at HEAD (the r3 finding's own runs). */
const RULES_AND_SETUP = [
  'Play the ball back in my stance?',
  'Play the ball forward?',
  'Play it as it lies?',
  'Play a provisional?',
  'Play two clubs more?',
  'Play up or play it as it lies?',
  'Play preferred lies?',
  'Play winter rules?',
  'Play it down?',
  'Kevin, play the ball off my back foot?',
];

let ls: LS;
let cs: CS;
let realNow: () => number;
let clock = 1_000_000;

beforeEach(() => {
  jest.resetModules();
  Object.assign(mockState, { captures: [], spoken: [], brainMessages: [], searches: [], pushes: 0, searchMode: 'match' });
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
  it('THE BUG: a rules or setup question that starts with "play" is not a song request', () => {
    for (const q of RULES_AND_SETUP) expect(detectPlaySongRequest(q)).toBeNull();
    // Speech-to-text drops the question mark: the golf object alone still decides it.
    for (const q of ['play the ball back in my stance', 'play it as it lies', 'play a provisional', 'play two clubs more']) {
      expect(detectPlaySongRequest(q)).toBeNull();
    }
  });

  it('a song request still is — a command, a polite question, a named song', () => {
    expect(detectPlaySongRequest('Kevin play Hotel California')?.query).toBe('Hotel California');
    expect(detectPlaySongRequest('Kevin, could you play Thunderstruck?')?.query).toBe('Thunderstruck');
    expect(detectPlaySongRequest('play Down Under by Men at Work')?.query).toBe('Down Under by Men at Work');
    expect(detectPlaySongRequest('play Wrecking Ball')?.query).toBe('Wrecking Ball');
    expect(detectPlaySongRequest('play the song Low')?.query).toBe('Low');
  });
});

describe('every round route: the rules question reaches the caddie, not YouTube', () => {
  for (const q of RULES_AND_SETUP) {
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
});

describe('a search that could not be made is not "couldn\'t find"', () => {
  it('offline: the song request goes to the brain turn (and its failure owner), not a false no-match', async () => {
    mockState.searchMode = 'real';
    await typed('Kevin play Thunderstruck');
    expect(mockState.searches).toEqual(['Thunderstruck']);
    expect(mockState.spoken.some((s) => /couldn't find/i.test(s))).toBe(false);
    expect(mockState.brainMessages).toEqual(['Kevin play Thunderstruck']);
  });

  it('server reached but YouTube not answering: says so, never blames the title', async () => {
    mockState.searchMode = 'real';
    (global as { fetch?: unknown }).fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ videoId: null, reason: 'upstream_403' }) }));
    await typed('Kevin play Thunderstruck');
    expect(mockState.spoken.some((s) => /couldn't find/i.test(s))).toBe(false);
    expect(mockState.spoken.some((s) => /music player isn't answering/.test(s))).toBe(true);
    expect(mockState.pushes).toBe(0);
  });

  it('control: a real no-match still says it could not find the song', async () => {
    mockState.searchMode = 'real';
    (global as { fetch?: unknown }).fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ videoId: null, reason: 'no_match' }) }));
    await typed('Kevin play Zzqx Unknown Tune');
    expect(mockState.spoken.some((s) => /couldn't find "Zzqx Unknown Tune"/.test(s))).toBe(true);
    expect(mockState.brainMessages).toEqual([]);
  });
});
