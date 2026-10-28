/**
 * 2026-10-28 (Brain review r3) — "HOW DOES LAG PUTTING WORK?" IS A GOLF QUESTION, NOT AN APP TOUR.
 *
 * detectHelpRequest took any "how do/does/should … use/work" as a how-to, matched feature names with
 * a substring test, and fell back to the SwingLab tour when none was named. Round 1 (B10) put it in
 * front of every brain turn — avatar mic, earbud, typed box, watch — so "How should I use the wind on
 * this hole?" got "This is SwingLab — your practice home…", "How do I use my wedges to score better?"
 * got the scorecard ('score'), and "How would you use the slope around the green?" got the Play tab
 * ('round' inside 'around'). The question never reached Kevin and the tour was filed as his turn.
 *
 * Drives the REAL listeningSession (typed box / watch, and earbud) through the real pre-brain step,
 * with the live route set the way app/_layout's pathname listener sets it.
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


import { detectHelpRequest, SCREEN_HELP } from '../../services/screenHelp';

type LS = typeof import('../../services/listeningSession');
type CS = typeof import('../../services/conversationState');
type RB = typeof import('../../services/routeBreadcrumb');

jest.setTimeout(120_000);

const flush = async (n = 40) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const said = (text: string): Capture => ({ text, bail: null, heardSpeech: true, durationMs: 1500 });

/** Every one of these returned an app tour at HEAD (the r3 finding's own runs). */
const GOLF_HOW_QUESTIONS = [
  'How should I use the wind on this hole?',
  'How does the release work in the downswing?',
  'How does lag putting work?',
  'How do I use my hybrid out of the rough?',
  'How do I use my wedges to score better?',
  'How would you use the slope around the green?',
];
const TOURS = Object.values(SCREEN_HELP).map((h) => h.spoken);

let ls: LS;
let cs: CS;
let rb: RB;
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
  rb = require('../../services/routeBreadcrumb') as RB;
  rb.setRoute('/caddie');
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
  it('THE BUG: a golf "how" question is not a help request, on any screen', () => {
    for (const q of GOLF_HOW_QUESTIONS) {
      expect(detectHelpRequest(q)).toBeNull();
      expect(detectHelpRequest(q, 'swinglab')).toBeNull();
    }
  });

  it('a feature named as the object is still help — on word boundaries', () => {
    expect(detectHelpRequest('how does the scorecard work')?.key).toBe('scorecard');
    expect(detectHelpRequest('Kevin, how do I use Smart Motion?')?.key).toBe('smartmotion');
    expect(detectHelpRequest('how do you use drills')?.key).toBe('drills');
    expect(detectHelpRequest('how does the play tab work?')?.key).toBe('play');
    // A golf word names the app only with a screen noun.
    expect(detectHelpRequest('how do I use the practice screen')?.key).toBe('swinglab');
    expect(detectHelpRequest('how does scoring work in stableford')).toBeNull();
  });

  it('"this" is the screen he is on — and with no help screen behind it, no tour at all', () => {
    expect(detectHelpRequest('how do I use this', 'scorecard')?.key).toBe('scorecard');
    expect(detectHelpRequest('what do I do here', 'drills')?.key).toBe('drills');
    expect(detectHelpRequest('how do I use this')).toBeNull();
    expect(detectHelpRequest('how does this drill work', 'drills')).toBeNull();
    // An unknown feature is Kevin's to answer, never the SwingLab default.
    expect(detectHelpRequest('how do I use SmartFinder')).toBeNull();
  });
});

describe('every route: the golf question reaches the caddie, not a canned tour', () => {
  for (const q of GOLF_HOW_QUESTIONS) {
    it(`typed / watch: "${q}"`, async () => {
      await typed(q);
      expect(mockState.brainMessages).toEqual([q]);
      expect(mockState.spoken.filter((s) => TOURS.includes(s))).toEqual([]);
    });

    it(`earbud: "${q}"`, async () => {
      await earbud(q);
      expect(mockState.brainMessages).toEqual([q]);
      expect(mockState.spoken.filter((s) => TOURS.includes(s))).toEqual([]);
    });
  }

  it('"how do I use this" on the scorecard gets the scorecard help (the live route is passed)', async () => {
    rb.setRoute('/scorecard');
    await typed('how do I use this?');
    expect(mockState.brainMessages).toEqual([]);
    expect(mockState.spoken).toContain(SCREEN_HELP.scorecard.spoken);
  });

  it('"how do I use this" on the caddie screen is a question for Kevin, not the SwingLab tour', async () => {
    rb.setRoute('/caddie');
    await typed('how do I use this?');
    expect(mockState.brainMessages).toEqual(['how do I use this?']);
    expect(mockState.spoken).not.toContain(SCREEN_HELP.swinglab.spoken);
  });
});
