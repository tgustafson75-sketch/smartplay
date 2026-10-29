/**
 * 2026-10-28 (recheck VC-6) — THE PATH 4 CHECKLIST COULD NEITHER PASS NOR FAIL TRUTHFULLY.
 *
 * openSession logged "[path4:voice] opener_done (canned opener removed — haptic + Listening strip)"
 * and then, one await later, SPOKE the opener: playVerbalCue('listen') says pickOpener(), which at L1
 * Quiet is TRUST_L1_OPENER "Yeah?", userInitiated so Quiet does not suppress it. That is deliberate
 * (08-08/08-23: a spoken go-ahead survives the BT handoff a tock does not), but docs/critical-paths.md
 * still said "L1 Quiet: opener/filler suppressed" and MIN VERIFY step 5 said "confirm opener+filler
 * silent", so a healthy phone failed the check. The documented marker fields did not exist either:
 * tap_open had no `source=`, opener_done no `allowed=`, and close printed `close (reason=x)` where the
 * doc greps `close reason=x`.
 *
 * Behavioural: a real tap at L1 is driven through listeningSession and the log lines it actually
 * prints are read back, then checked against the fields docs/critical-paths.md documents.
 */
const mockTrust = { level: 1 as 1 | 2 | 3, clipCached: true };
let clock = 1_000_000;
type Capture = { text: string | null; bail: string | null; heardSpeech: boolean; durationMs: number | null };

const mockState = {
  lastSpoken: null as string | null,
  captures: [] as Array<Capture | (() => Promise<Capture>)>,
  captureCalls: 0,
  spoken: [] as string[],
  captions: [] as string[],
  brain: [] as Array<() => Promise<{ text: string | null; audioBase64: string | null; toolActions: unknown[] }>>,
  brainCalls: 0,
  askCaddie: [] as Array<(opts: { signal?: AbortSignal }) => Promise<unknown>>,
  askCaddieSignals: [] as Array<AbortSignal | undefined>,
  precheck: null as null | ((u: string) => unknown),
  handler: null as null | { execute: () => Promise<unknown> },
  roundActive: false,
  speakingUserInitiated: false,
  speaking: false,
  stopCalls: 0,
  speakImpl: null as null | ((text: string) => Promise<void>),
  cueMs: 0,
};

const noCapture: Capture = { text: null, bail: 'cancelled', heardSpeech: false, durationMs: 0 };

jest.mock('../../services/voiceService', () => ({
  speak: jest.fn(async (text: string) => {
    mockState.spoken.push(text);
    mockState.lastSpoken = text;
    if (mockState.speakImpl) await mockState.speakImpl(text);
  }),
  speakFromBase64: jest.fn(async (_b: string, o?: { caption?: string }) => {
    mockState.spoken.push(o?.caption ?? '(audio)');
    mockState.lastSpoken = o?.caption ?? null;
  }),
  stopSpeaking: jest.fn(async () => { mockState.stopCalls += 1; mockState.speaking = false; }),
  captureUtteranceDetailed: jest.fn(async () => {
    mockState.captureCalls += 1;
    const next = mockState.captures.shift();
    if (!next) return noCapture;
    return typeof next === 'function' ? next() : next;
  }),
  releaseExternalMic: jest.fn(async () => 'none'),
  // The spoken open cue takes real time: 'listening' arms only after it (listeningSession openSession).
  playLocalFile: jest.fn(async () => { clock += mockState.cueMs; }),
  stopCapture: jest.fn(async () => undefined),
  endCaptureEarly: jest.fn(),
  flashCaption: jest.fn((t: string) => { mockState.captions.push(t); }),
  getLastSpokenLine: jest.fn(() => mockState.lastSpoken),
  isCapturing: jest.fn(() => false),
  isExternalMicActive: jest.fn(() => false),
  speakDeviceNotice: jest.fn(async (t: string) => { mockState.spoken.push(t); }),
  isSpeaking: jest.fn(() => mockState.speaking),
  isSpeakingUserInitiated: jest.fn(() => mockState.speaking && mockState.speakingUserInitiated),
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
  conversationalBrainTurn: jest.fn(async () => {
    mockState.brainCalls += 1;
    const next = mockState.brain.shift();
    return next ? next() : { text: null, audioBase64: null, toolActions: [] };
  }),
}));
jest.mock('../../services/caddieBrain', () => ({
  askCaddie: jest.fn(async (opts: { signal?: AbortSignal }) => {
    mockState.askCaddieSignals.push(opts.signal);
    const next = mockState.askCaddie.shift();
    return next ? next(opts) : null;
  }),
}));
jest.mock('../../services/voiceWarmup', () => ({ abortVoiceWarmup: jest.fn() }));
jest.mock('../../services/userTurnClock', () => ({ noteUserTurn: jest.fn(), getUserTurnEpoch: jest.fn(() => 1) }));
jest.mock('../../services/funnelEvents', () => ({ noteCaddieTurn: jest.fn() }));
jest.mock('../../services/featureAccess', () => ({ takeCaddiePaywallBlock: jest.fn(() => null), CADDIE_PAYWALL_DEFERRED_LINE: 'deferred' }));
jest.mock('../../services/dialogEngine', () => ({ getDialog: jest.fn(() => 'Go ahead.') }));
jest.mock('../../services/trustLevelService', () => ({ getTrustLevel: jest.fn(() => mockTrust.level) }));
jest.mock('../../store/roundStore', () => ({
  useRoundStore: { getState: () => ({
    isRoundActive: mockState.roundActive, activeCourse: null, mode: 'stroke', currentHole: 1, shots: [],
    getHolesPlayed: () => 0, getTotalScore: () => 0, getScoreVsPar: () => 0,
  }) },
}));
jest.mock('../../store/settingsStore', () => ({
  useSettingsStore: { getState: () => ({
    voiceEnabled: true, language: 'en', voiceGender: 'male', aiProvider: 'gemini',
    caddiePersonality: 'kevin', autoListenEnabled: false,
    caddieAssignments: { round: 'kevin', practice: 'kevin', drills: 'kevin', play: 'kevin' },
  }) },
}));
jest.mock('../../services/intents', () => ({
  voiceCommandRouter: { getHandler: jest.fn(() => mockState.handler) },
}));
jest.mock('../../services/earbudControl', () => ({ subscribeEarbudTap: jest.fn(() => () => undefined) }));
jest.mock('../../services/smartMotionRecordBus', () => ({ isSmartMotionRecording: jest.fn(() => false), emitSmartMotionCommand: jest.fn() }));
jest.mock('../../services/responseRouter', () => ({ routeQuery: jest.fn(() => ({ filler: null })) }));
jest.mock('../../services/activeSurfaceRegistry', () => ({ getActiveSurface: jest.fn(() => 'caddie') }));
jest.mock('../../services/localIntentPrecheck', () => ({
  precheckLocalIntent: jest.fn((u: string) => (mockState.precheck ? mockState.precheck(u) : null)),
}));
jest.mock('../../services/pendingDisambiguation', () => ({ resolvePendingCourseUtterance: jest.fn(() => null) }));
jest.mock('../../store/voiceHitRateStore', () => ({ useVoiceHitRateStore: { getState: () => ({ recordLocal: jest.fn(), recordCloud: jest.fn() }) } }));
jest.mock('../../services/apiBase', () => ({
  getApiBaseUrl: () => 'http://localhost:9', isEndpointWarmed: () => true, markEndpointWarmed: jest.fn(),
}));
jest.mock('../../services/pendingPuttAsk', () => ({ tryAnswerOpenQuestion: jest.fn(() => null) }));
jest.mock('../../store/flagStore', () => ({ isFlagEnabled: jest.fn(() => true) }));
jest.mock('../../services/adviceFreshness', () => ({
  adviceIsStillWorthSaying: jest.fn(() => true), captureShotEpoch: jest.fn(() => null), currentTurnEpoch: jest.fn(() => null),
}));
jest.mock('../../services/caddieFailureReply', () => ({
  failureNotice: jest.fn(async () => 'That one got away from me — say it again?'),
  failureNoticeSync: jest.fn(() => 'That one got away from me — say it again?'),
  localAnswer: jest.fn(() => null),
}));
jest.mock('../../store/listeningSessionStore', () => ({ useListeningSessionStore: { getState: () => ({ setState: jest.fn() }) } }));
jest.mock('../../services/offlineVoiceCache', () => ({ resolveCachedOfflineClipUri: jest.fn(() => (mockTrust.clipCached ? 'file:///cue.mp3' : null)) }));
jest.mock('../../services/voice/conversationalToolDispatch', () => ({ dispatchConversationalToolActions: jest.fn() }));

type LS = typeof import('../../services/listeningSession');

jest.setTimeout(120_000);

const flush = async (n = 30) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

let ls: LS;
let realNow: () => number;
let logs: string[] = [];
let logSpy: jest.SpyInstance;

beforeEach(() => {
  jest.resetModules();
  Object.assign(mockState, {
    lastSpoken: null, captures: [], captureCalls: 0, spoken: [], captions: [], brain: [], brainCalls: 0,
    askCaddie: [], askCaddieSignals: [], precheck: null, handler: null, roundActive: false,
    speakingUserInitiated: false, speaking: false, stopCalls: 0, speakImpl: null, cueMs: 0,
  });
  Object.assign(mockTrust, { level: 1, clipCached: true });
  realNow = Date.now;
  clock = 1_000_000;
  Date.now = () => clock;
  logs = [];
  logSpy = jest.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { logs.push(a.map(String).join(' ')); });
  ls = require('../../services/listeningSession') as LS;
  (global as { fetch?: unknown }).fetch = jest.fn(async () => { throw new Error('offline in test'); });
});
afterEach(() => { Date.now = realNow; ls.forceCloseSession(); logSpy.mockRestore(); });

const path4 = (stem: string) => logs.filter((l) => l.startsWith(`[path4:voice] ${stem}`));

/** Tap once, holding the capture open so the session sits in 'listening'. */
async function tapAndHold(): Promise<() => void> {
  const hold = deferred<Capture>();
  mockState.captures.push(() => hold.promise);
  clock += 5_000;
  void ls.toggle();
  await flush();
  expect(ls.getSessionState()).toBe('listening');
  return () => hold.resolve(noCapture);
}

describe('Path 4 markers say what the tap actually did', () => {
  it('L1 Quiet SPEAKS the terse go-ahead "Yeah?", and opener_done says so — not "removed"', async () => {
    const { TRUST_L1_OPENER } = require('../../services/caddieAckLines') as typeof import('../../services/caddieAckLines');
    const release = await tapAndHold();
    const vs = require('../../services/voiceService') as { playLocalFile: jest.Mock };
    // The cue really played, in the caddie's cached clip, user-initiated (so Quiet does not drop it).
    expect(vs.playLocalFile).toHaveBeenCalledWith('file:///cue.mp3', undefined, { userInitiated: true });
    const done = path4('opener_done');
    expect(done).toHaveLength(1);
    expect(done[0]).toContain('allowed=true');
    expect(done[0]).toContain(`text=${JSON.stringify(TRUST_L1_OPENER)}`);
    expect(done[0]).toContain('via=clip');
    expect(done[0]).toContain('trust=1');
    expect(logs.join('\n')).not.toMatch(/canned opener removed/);
    release();
  });

  it('opener_done is logged AFTER the cue, so it can report the earcon fallback honestly', async () => {
    mockTrust.clipCached = false;
    mockTrust.level = 2;
    const release = await tapAndHold();
    const done = path4('opener_done');
    expect(done).toHaveLength(1);
    expect(done[0]).toContain('via=earcon');
    expect(done[0]).toContain('text="Go ahead."');
    release();
  });

  it('tap_open carries source=, and close prints `close reason=` exactly as the doc greps it', async () => {
    const release = await tapAndHold();
    expect(path4('tap_open')[0]).toMatch(/^\[path4:voice\] tap_open trust=1 source=tap$/);
    release();
    ls.forceCloseSession();
    expect(path4('close').some((l) => l === '[path4:voice] close reason=user_close')).toBe(true);
    expect(logs.join('\n')).not.toContain('close (reason=');
  });
});

describe('docs/critical-paths.md documents the markers the code emits', () => {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const doc = fs.readFileSync(path.resolve(__dirname, '../../docs/critical-paths.md'), 'utf-8');

  it('the L1 pass criterion and MIN VERIFY step 5 describe the spoken "Yeah?", not a silent opener', () => {
    expect(doc).not.toMatch(/L1 Quiet: opener\/filler suppressed/);
    expect(doc).not.toMatch(/confirm opener\+filler silent/);
    expect(doc).toMatch(/opener_done … text="Yeah\?"/);
  });

  it('every documented field is one the code prints', () => {
    expect(doc).toContain('`[path4:voice] tap_open trust=N source=tap|auto_reopen`');
    expect(doc).toContain('`[path4:voice] opener_done allowed=true|false text="<spoken line>" via=clip|earcon|none trust=N`');
    expect(doc).toContain('`[path4:voice] close reason=user_close|dormancy_timeout`');
    expect(doc).not.toContain('tap_open trust=N source=earbud|onscreen');
    expect(doc).not.toContain('`[path4:voice] close reason=natural|user_tap|state_change`');
  });

  it('every `[path4:voice] <stem>` the doc lists is printed somewhere in the voice code, with that field', () => {
    const section = doc.slice(doc.indexOf('**Diagnostic markers (grep `[path4:voice]`):**'), doc.indexOf('**MIN VERIFY (~5 min):**', doc.indexOf('[path4:voice]')));
    const stems = [...section.matchAll(/`\[path4:voice\] ([a-z_]+)([= ][a-z_]+=?)?/g)].map((m) => `[path4:voice] ${m[1]}${m[2] ?? ''}`);
    expect(stems.length).toBeGreaterThanOrEqual(12);
    const src = ['services/listeningSession.ts']
      .map((f) => fs.readFileSync(path.resolve(__dirname, '../..', f), 'utf-8')).join('\n');
    const missing = stems.filter((st) => !src.includes(st));
    expect(missing).toEqual([]);
    // and nothing in the section still calls the spoken L1 go-ahead a failure
    expect(doc).not.toContain('- Opener speaks at L1 (Quiet leak regression).');
  });
});
