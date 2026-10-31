/**
 * 2026-10-31 (caddie-home CAD-R1) — A BADGE TAP ENDS THE TAP-PATH RECORDER, EVEN WHEN IT HEARD NOTHING.
 *
 * Caddie home: the caddie asks a question, so the tab hands the mic over (handleMicPress), and the tab's own
 * Audio.Recording opens. It registers as an external mic holder, so a badge, bar or earbud tap in that state
 * reaches toggle()'s held-utterance branch. That branch asks the utterance endpoints only, and the tap-path
 * recorder registered its release but not its endpoint. The tap was refused as "held elsewhere" and buzzed,
 * with nothing ending the recorder until its silence-VAD (which needs speech) or the 18 s cap.
 *
 * Driven for real: the tab hook (hooks/useVoiceCaddie) mounted with expo-av stubbed, the real voiceService
 * registry. The assertion is on the registry's verdict, which is what toggle() acts on.
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
              getURI: () => 'file:///tap.m4a',
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

describe('a badge tap ends the tap-path recorder that holds the mic', () => {
  const vs = jest.requireActual('../../services/voiceService') as typeof import('../../services/voiceService');
  const { useVoiceCaddie } = require('../../hooks/useVoiceCaddie') as typeof import('../../hooks/useVoiceCaddie');

  async function mountAndOpen() {
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
    return { unmount: async () => rtrAct(async () => { r?.unmount(); await flush(); }) };
  }

  beforeEach(() => { mockAv.live = []; });

  it('the caddie opens its own recorder and it holds the mic', async () => {
    const h = await mountAndOpen();
    expect(mockAv.live.length).toBe(1);
    expect(vs.isExternalMicActive()).toBe(true);
    await h.unmount();
  });

  it('THE BUG: a tap while that recorder heard nothing ends it, so the mic is free for the tap to open a turn', async () => {
    const h = await mountAndOpen();
    const verdict = await vs.endHeldUtterance();
    expect(verdict).toBe('discarded');
    expect(mockAv.live[0].stopped).toBe(true);
    expect(vs.isExternalMicActive()).toBe(false);
    await h.unmount();
  });

  it('the badge tap itself: toggle() opens a listening session over the silent recording instead of buzzing', async () => {
    const ls = jest.requireActual('../../services/listeningSession') as typeof import('../../services/listeningSession');
    const h = await mountAndOpen();
    expect(vs.isExternalMicActive()).toBe(true);
    await rtrAct(async () => { await ls.toggle(); await flush(); });
    expect(ls.getSessionState()).not.toBe('idle');
    expect(mockAv.live[0].stopped).toBe(true);
    await h.unmount();
  });
});
