/**
 * 2026-10-28 (voice engineering review, VOICE-ENG-4) — LOCKING THE PHONE MID-TURN TORE THE AUDIO DOWN.
 *
 * audioLifecycle's idle teardown asks whether audio is in use; its two EVENT teardowns did not. The
 * app going to the background (the phone locked into a pocket — the core on-course flow) or a flip
 * to Quiet ran goCold at once, mid-turn: allowsRecordingIOS false under a live recording makes expo-av
 * pause the iOS recorder (the capture reads 0 ms and is dropped), and playsInSilentModeIOS false under
 * a live reply silences it on a phone in silent mode.
 *
 * Driven through the real controller; the audio-mode call, AppState and the trust store are stubbed.
 */
const mockAudio = {
  speaking: false,
  capturing: false,
  externalMic: false,
  session: 'idle' as string,
  modeCalls: [] as Record<string, unknown>[],
  appStateListener: null as null | ((s: string) => void),
  trustListener: null as null | ((s: { level: number }) => void),
};

jest.mock('react-native', () => ({
  AppState: {
    currentState: 'active',
    addEventListener: (_e: string, l: (s: string) => void) => { mockAudio.appStateListener = l; return { remove: () => { mockAudio.appStateListener = null; } }; },
  },
}));
jest.mock('@sentry/react-native', () => ({ addBreadcrumb: jest.fn() }));
jest.mock('../../services/voiceService', () => ({
  setAudioModeSerial: jest.fn(async (m: Record<string, unknown>) => { mockAudio.modeCalls.push(m); }),
  isSpeaking: () => mockAudio.speaking,
  isCapturing: () => mockAudio.capturing,
  isExternalMicActive: () => mockAudio.externalMic,
}));
jest.mock('../../services/listeningSession', () => ({ getSessionState: () => mockAudio.session }));
jest.mock('../../store/trustLevelStore', () => ({
  useTrustLevelStore: { subscribe: (l: (s: { level: number }) => void) => { mockAudio.trustListener = l; return () => { mockAudio.trustListener = null; }; } },
}));

type AL = typeof import('../../services/audioLifecycle');
let al: AL;
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

beforeEach(() => {
  jest.resetModules();
  jest.useFakeTimers();
  Object.assign(mockAudio, { speaking: false, capturing: false, externalMic: false, session: 'idle', modeCalls: [] });
  al = require('../../services/audioLifecycle') as AL;
  al.initAudioLifecycle();
  al.noteAudioActivity('test');            // warm, as any turn leaves it
});
afterEach(() => { al.teardownAudioLifecycle(); jest.useRealTimers(); });

describe('a turn in flight keeps its audio session', () => {
  it('locking the phone while the reply is playing does not silence it', async () => {
    mockAudio.speaking = true;
    mockAudio.session = 'responding';
    mockAudio.appStateListener!('background');
    await flush();
    expect(mockAudio.modeCalls).toHaveLength(0);
    expect(al.getAudioState()).toBe('warm');
  });

  it('locking the phone while the mic is recording does not pause the recorder', async () => {
    mockAudio.capturing = true;
    mockAudio.session = 'listening';
    mockAudio.appStateListener!('background');
    await flush();
    expect(mockAudio.modeCalls).toHaveLength(0);
  });

  it('a session between audio (thinking: brain in flight) is a live turn too', async () => {
    mockAudio.session = 'thinking';
    mockAudio.appStateListener!('inactive');
    await flush();
    expect(mockAudio.modeCalls).toHaveLength(0);
  });

  it('flipping to Quiet mid-reply does not cut the reply', async () => {
    mockAudio.speaking = true;
    mockAudio.session = 'responding';
    mockAudio.trustListener!({ level: 1 });
    await flush();
    expect(mockAudio.modeCalls).toHaveLength(0);
  });

  it('the deferred teardown still happens once the turn is over', async () => {
    mockAudio.speaking = true;
    mockAudio.session = 'responding';
    mockAudio.appStateListener!('background');
    await flush();
    mockAudio.speaking = false;
    mockAudio.session = 'idle';
    await jest.advanceTimersByTimeAsync(15_000);
    await flush();
    expect(mockAudio.modeCalls).toHaveLength(1);
    expect(mockAudio.modeCalls[0]).toMatchObject({ allowsRecordingIOS: false, playsInSilentModeIOS: false });
    expect(al.getAudioState()).toBe('cold');
  });

  it('coming back to the app before the turn ends cancels the deferred background teardown', async () => {
    mockAudio.speaking = true;
    mockAudio.session = 'responding';
    mockAudio.appStateListener!('background');
    mockAudio.appStateListener!('active');
    mockAudio.speaking = false;
    mockAudio.session = 'idle';
    await jest.advanceTimersByTimeAsync(15_000);
    await flush();
    expect(mockAudio.modeCalls).toHaveLength(0);
  });

  it('with nothing in flight, backgrounding still goes cold at once (unchanged)', async () => {
    mockAudio.appStateListener!('background');
    await flush();
    expect(mockAudio.modeCalls).toHaveLength(1);
  });
});
