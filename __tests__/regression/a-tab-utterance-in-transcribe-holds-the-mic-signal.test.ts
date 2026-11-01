/**
 * 2026-10-31 (caddie-voice CAD-VOICE-1) — A SUBMITTED TAB UTTERANCE HOLDS THE SHARED MIC SIGNAL FROM SUBMIT.
 *
 * The badge, the bottom bar and toggle() read the shared listening store and its held-turn count. The caddie
 * tab's mic took the held turn only once the transcript reached useCaddieTabMic.processTurn, so for the whole
 * transcribe and pre-brain wait the store read 'idle', the mic stayed bright, and a badge or earbud tap opened a
 * second turn over the first answer (and paid for a second brain call).
 *
 * Driven for real: the tab hook (hooks/useVoiceCaddie) mounted with expo-av stubbed, a recording stopped through
 * handleMicPress, and a transcribe that never returns. The assertions are on the store and on toggle().
 */
import { createElement } from 'react';

type Status = { isRecording: boolean; metering?: number };
const mockAv = {
  live: [] as Array<{ stopped: boolean; push: (s: Status) => void }>,
};

jest.mock('expo-av', () => {
  const leaf = new Proxy({}, { get: (_t, p) => String(p) });
  return {
    __esModule: true,
    InterruptionModeIOS: leaf,
    InterruptionModeAndroid: leaf,
    Audio: {
      AndroidOutputFormat: leaf, AndroidAudioEncoder: leaf, IOSOutputFormat: leaf, IOSAudioQuality: leaf,
      requestPermissionsAsync: async () => ({ granted: true, canAskAgain: true, status: 'granted' }),
      getPermissionsAsync: async () => ({ granted: true }),
      setAudioModeAsync: async () => undefined,
      Sound: { createAsync: async () => ({ sound: { unloadAsync: async () => undefined, stopAsync: async () => undefined } }) },
      Recording: {
        createAsync: async () => {
          let cb: (s: Status) => void = () => {};
          const rec = { stopped: false, push: (s: Status) => cb(s) };
          mockAv.live.push(rec);
          return {
            recording: {
              getURI: () => 'file:///tab.m4a',
              getStatusAsync: async () => ({ durationMillis: 2000 }),
              setProgressUpdateInterval: () => undefined,
              setOnRecordingStatusUpdate: (f: (s: Status) => void) => { cb = f; },
              stopAndUnloadAsync: async () => { rec.stopped = true; },
            },
          };
        },
      },
    },
  };
});

jest.mock('expo-file-system/legacy', () => ({
  getInfoAsync: async () => ({ exists: true, size: 50_000 }),
  cacheDirectory: '/tmp/', documentDirectory: '/tmp/',
}));
jest.mock('expo-router', () => ({ usePathname: () => '/caddie', router: { push: () => undefined } }));
jest.mock('../../store/flagStore', () => ({ isFlagEnabled: () => true }));
jest.mock('expo-haptics', () => ({ impactAsync: async () => undefined, notificationAsync: async () => undefined, selectionAsync: async () => undefined }));
jest.mock('../../contexts/KevinPresenceContext', () => ({
  useKevinPresence: () => ({ setIsThinking: () => undefined, setVoiceState: () => undefined, presence: 'idle' }),
}));
jest.mock('../../services/voiceWarmup', () => ({ prewarmVoice: () => undefined, abortVoiceWarmup: () => undefined }));
jest.mock('../../services/appForeground', () => ({
  settleForegroundForMic: async () => 'active', micMayBeRefusedNow: () => false,
}));
jest.mock('../../services/apiBase', () => ({
  getApiBaseUrl: () => 'http://localhost:9', isEndpointWarmed: () => true, markEndpointWarmed: () => undefined,
  ensureBackendReachable: async () => true,
}));
jest.mock('../../services/voiceErrorLog', () => ({
  logVoiceError: () => undefined, logTranscribeError: () => undefined, logVoiceSilentFail: () => undefined,
  logVoiceDiag: () => undefined, noteVoiceTurnStarted: () => undefined, describeError: String,
}));

type Renderer = { update: (el: ReturnType<typeof createElement>) => void; unmount: () => void };
const { create, act: rtrAct } = require('react-test-renderer') as {
  create: (el: ReturnType<typeof createElement>) => Renderer;
  act: (fn: () => Promise<void> | void) => Promise<void>;
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const flush = async (n = 30) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

jest.setTimeout(60_000);

describe('a submitted caddie-tab utterance holds the mic signal the badge, the bar and toggle() read', () => {
  const { useVoiceCaddie } = require('../../hooks/useVoiceCaddie') as typeof import('../../hooks/useVoiceCaddie');
  const ls = jest.requireActual('../../services/listeningSession') as typeof import('../../services/listeningSession');
  const { useListeningSessionStore } = jest.requireActual('../../store/listeningSessionStore') as typeof import('../../store/listeningSessionStore');
  const { micTapLook } = jest.requireActual('../../services/voice/tapIsDroppedIn') as typeof import('../../services/voice/tapIsDroppedIn');
  const realFetch = (globalThis as { fetch?: unknown }).fetch;

  // Every network call in the turn stays open until the test drains it, so the turn is genuinely in transcribe.
  let holding = true;
  const open: Array<(e: Error) => void> = [];
  const drain = async () => {
    holding = false;
    open.splice(0).forEach((rej) => rej(new Error('drained by test')));
    await flush(200);
  };
  beforeEach(() => {
    holding = true;
    (globalThis as { fetch?: unknown }).fetch = jest.fn(() => (holding
      ? new Promise<Response>((_res, rej) => { open.push(rej); })
      : Promise.reject(new Error('offline in test'))));
  });
  afterEach(() => { (globalThis as { fetch?: unknown }).fetch = realFetch; });

  /** Mount the tab hook, start a recording, and return a submit (the second tap, which is the STOP) and an unmount. */
  async function mountWithRecording() {
    let api: ReturnType<typeof useVoiceCaddie> | null = null;
    const Probe = (): null => {
      api = useVoiceCaddie({
        onVoiceStateChange: () => undefined,
        onResponseReceived: () => undefined,
      } as Parameters<typeof useVoiceCaddie>[0]);
      return null;
    };
    let r: Renderer | null = null;
    await rtrAct(async () => { r = create(createElement(Probe)); await flush(); });
    await rtrAct(async () => { await api!.handleMicPress(); await flush(); });
    return {
      // Not awaited: the STOP runs processAudioUri to its end, and in these tests that is the held transcribe.
      submit: async () => { await new Promise((r) => setTimeout(r, 600)); await rtrAct(async () => { void api!.handleMicPress(); await flush(); }); },
      unmount: async () => rtrAct(async () => { r?.unmount(); await flush(); }),
    };
  }

  it('THE BUG: a tab utterance in transcribe dims the mic, and a badge tap is dropped instead of opening a second turn', async () => {
    const h = await mountWithRecording();
    await h.submit();
    await flush();

    expect(useListeningSessionStore.getState().state).toBe('thinking');
    expect(micTapLook(useListeningSessionStore.getState().state)).toEqual({ opacity: 0.4, dropped: true });

    void ls.toggle();
    await flush();
    expect(ls.getSessionState()).toBe('idle');

    await drain();
    await h.unmount();
  });

  it('a submitted utterance that dies in transcribe gives the mic back, so the next tap is not dropped', async () => {
    const h = await mountWithRecording();
    holding = false;
    await h.submit();
    // The failure path (offline reply, probes) runs to its own end; wait for the turn to give the mic back.
    for (let i = 0; i < 500 && useListeningSessionStore.getState().state !== 'idle'; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    await flush();

    expect(useListeningSessionStore.getState().state).toBe('idle');
    void ls.toggle();
    await flush();
    expect(ls.getSessionState()).not.toBe('idle');
    await h.unmount();
  });
});
