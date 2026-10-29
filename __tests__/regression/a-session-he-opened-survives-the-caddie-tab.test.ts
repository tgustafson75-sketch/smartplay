/**
 * 2026-10-28 (recheck VC-R2-1, VC-R2-3) — A SESSION THE PLAYER OPENED WAS CLOSED BY THE CADDIE TAB.
 *
 * VC-R2-1 — the tab hands the mic over by itself after a reply that asks a question (onReadyToListen),
 * after the get-to-know opener and after a SmartMotion set. All three called the avatar's tap
 * handler. The commonest moment to press the badge, the bottom bar or an earbud is WHILE the caddie is
 * asking — so the hand-off landed on his session: during 'opening' it force-closed it (cue cut, turn
 * gone), during 'listening' it ended his capture at ~0 s ("Didn't catch that"). Cold open, opener
 * speaking, tap the badge: the opener's .finally killed the session he had just opened.
 *
 * VC-R2-3 — tapping Kevin's FACE during 'opening' (painted as idle, so it is when he taps the face to
 * talk) force-closed the session; the same tap on the badge means "I'm ready" and opens the mic.
 *
 * Driven on the real listeningSession: a session opened with toggle(), then the hand-off, then a face
 * tap routed by the rule handleMicPress uses (avatarTapRoute).
 */
import fs from 'fs';
import path from 'path';

jest.setTimeout(120_000);
const flush = async (n = 30) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

type Harness = {
  ls: typeof import('../../services/listeningSession');
  order: string[];
  advance: (ms: number) => void;
  releaseCue: () => void;
  restore: () => void;
};

function loadSession(): Harness {
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
    // Stopping speech ends whatever cue is playing, as the real speak queue does.
    stopSpeaking: jest.fn(async () => { order.push('stopSpeaking'); releaseCue(); }),
    // The mic stays open until the test ends it, so 'listening' can be observed.
    captureUtteranceDetailed: jest.fn(async () => {
      order.push('capture');
      await new Promise<void>((r) => { endCapture = r; });
      return { text: 'lay up', bail: null, heardSpeech: true, durationMs: 1500 };
    }),
    releaseExternalMic: jest.fn(async () => 'none'),
    // The open cue is still playing until the test releases it; later calls are the got-it cue.
    playLocalFile: jest.fn(async () => {
      cueCalls += 1;
      order.push(cueCalls === 1 ? 'open_cue' : 'gotit_cue');
      if (cueCalls === 1) await new Promise<void>((r) => { releaseCue = r; });
    }),
    stopCapture: jest.fn(async () => undefined),
    endCaptureEarly: jest.fn(() => { order.push('endCaptureEarly'); endCapture(); }),
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
  jest.doMock('../../services/voiceErrorLog', () => ({ logVoiceSilentFail: jest.fn(), logVoiceDiag: jest.fn((stage: string) => { order.push(`diag:${stage}`); }), describeError: String }));
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
  return {
    ls, order,
    advance: (ms) => { clock += ms; },
    releaseCue: () => releaseCue(),
    restore: () => { try { ls.forceCloseSession(); } catch { /* */ } endCapture(); Date.now = realNow; },
  };
}
let endCapture: () => void = () => {};

/** What useVoiceCaddie.handleMicPress does with a face tap while a session is live. */
function faceTap(h: Harness): void {
  const route = h.ls.avatarTapRoute(h.ls.getSessionState(), h.ls.isSessionInFlight());
  if (route === 'session') void h.ls.toggle();
  else if (route === 'force_close') h.ls.forceCloseSession();
}

describe('VC-R2-1 — an automatic hand-off yields to a session the player opened', () => {
  it("THE REPORT: he taps the badge while she asks; the hand-off lands in 'opening' and his session survives", async () => {
    const h = loadSession();
    try {
      void h.ls.toggle();                         // badge / bottom bar / earbud
      await flush();
      expect(h.ls.getSessionState()).toBe('opening');
      // The opener's .finally / onReadyToListen 500 ms later. What it used to call: the avatar handler,
      // which force-closed an in-flight session.
      const handedOff = h.ls.handMicToPlayer(() => { h.ls.forceCloseSession(); }, 'tab_reply_question');
      expect(handedOff).toBe(false);
      expect(h.ls.getSessionState()).toBe('opening');
      expect(h.order).toContain('diag:auto_listen_yielded');
      h.releaseCue();
      await flush(60);
      expect(h.ls.getSessionState()).toBe('listening');
      expect(h.order).toContain('capture');
    } finally { h.restore(); }
  });

  it("and in 'listening' it does not end his capture at ~0 s", async () => {
    const h = loadSession();
    try {
      void h.ls.toggle();
      await flush();
      h.releaseCue();
      await flush(60);
      expect(h.ls.getSessionState()).toBe('listening');
      h.advance(1_500);                           // outside the echo window, as a real hand-off is
      // What the hand-off used to reach: handleMicPress → toggle() → "I'm done".
      expect(h.ls.handMicToPlayer(() => { void h.ls.toggle(); }, 'tab_reply_question')).toBe(false);
      await flush();
      expect(h.order).not.toContain('endCaptureEarly');
      expect(h.ls.getSessionState()).toBe('listening');
    } finally { h.restore(); }
  });

  it('with no session it hands the mic over as before', async () => {
    const h = loadSession();
    try {
      let opened = 0;
      expect(h.ls.handMicToPlayer(() => { opened += 1; }, 'tab_reply_question')).toBe(true);
      expect(opened).toBe(1);
    } finally { h.restore(); }
  });

  it('every automatic hand-off on the Caddie tab goes through it', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../app/(tabs)/caddie.tsx'), 'utf8');
    const calls = src.match(/handleMicPressRef\.current\(\)/g) ?? [];
    const routed = src.match(/handMicToPlayer\(\(\) => handleMicPressRef\.current\(\), '[a-z_]+'\)/g) ?? [];
    expect(routed).toHaveLength(3);               // opener, SmartMotion set, onReadyToListen
    expect(calls).toHaveLength(routed.length);    // no bare call left
    expect(src).toMatch(/onReadyToListen: \(\) => \{ handMicToPlayer\(/);
  });
});

describe("VC-R2-3 — a face tap means what the badge's tap means", () => {
  it("THE REPORT: face tap during 'opening' opens the mic instead of killing the turn", async () => {
    const h = loadSession();
    try {
      void h.ls.toggle();                         // the badge
      await flush();
      expect(h.ls.getSessionState()).toBe('opening');
      h.advance(1_500);                           // a person, not an echo
      faceTap(h);
      await flush(60);
      // The badge's "I'm ready": cue cut, mic open — not a closed session.
      expect(h.order.filter((e) => !e.startsWith('diag:')).slice(0, 3)).toEqual(['open_cue', 'stopSpeaking', 'capture']);
      expect(h.ls.getSessionState()).toBe('listening');
    } finally { h.restore(); }
  });

  it("every live state routes to the session's own toggle; only a hung one is force-closed", () => {
    const { avatarTapRoute } = jest.requireActual('../../services/voice/tapIsDroppedIn') as typeof import('../../services/voice/tapIsDroppedIn');
    for (const st of ['opening', 'listening', 'thinking', 'responding']) expect(avatarTapRoute(st, true)).toBe('session');
    expect(avatarTapRoute('responding', false)).toBe('session');
    expect(avatarTapRoute('idle', true)).toBe('force_close');
    expect(avatarTapRoute('idle', false)).toBe('tab');
  });

  it('is the rule handleMicPress runs', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../hooks/useVoiceCaddie.ts'), 'utf8');
    expect(src).toMatch(/const sessionRoute = avatarTapRoute\(getSessionState\(\), isSessionInFlight\(\)\);\s*if \(sessionRoute === 'session'\) \{\s*try \{ void toggleListeningSession\(\);/);
    expect(src).toMatch(/if \(sessionRoute === 'force_close'\) \{\s*try \{ forceCloseSession\(\);/);
  });
});
