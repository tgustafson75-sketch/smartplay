/**
 * 2026-10-28 (recheck VC-R2-2) — THE CADDIE TAB'S AUTO-LISTEN RECORDER KEPT THE MIC THROUGH A SESSION.
 *
 * Active Listening on, a round live, phone on speaker. Tim taps the bottom-bar mic or the header badge:
 * listeningSession.toggle() opens a session, which never touches the tab's voiceState — and VAD was
 * gated on voiceState alone, so it kept recording. Its recorder was in neither mic-owner set, so the
 * session could not see it or take the mic back: the session's capture died on "Only one Recording
 * object" (bail 'error', the retry, then the mic-trouble line). And the gate cancelled VAD's OWN turns:
 * onSpeechStart set 'listening', which closed the gate, which threw the clip away before onSpeechEnd —
 * the avatar stuck on 'listening' and auto-listen off for the visit.
 *
 * Driven for real: the gate (services/voice/autoListenGate), the real hook
 * (hooks/useVoiceActivityDetection) on a stubbed expo-av, and the real voiceService registry.
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
      requestPermissionsAsync: async () => ({ granted: true }),
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
              getURI: () => 'file:///vad.m4a',
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

const mockSession = { state: 'idle', inFlight: false };
jest.mock('../../services/listeningSession', () => ({
  getSessionState: () => mockSession.state,
  isSessionInFlight: () => mockSession.inFlight,
}));
jest.mock('../../services/smartMotionRecordBus', () => ({ isSmartMotionActive: () => false, isSmartMotionRecording: () => false }));

type Renderer = { update: (el: ReturnType<typeof createElement>) => void; unmount: () => void };
const { create, act: rtrAct } = require('react-test-renderer') as {
  create: (el: ReturnType<typeof createElement>) => Renderer;
  act: (fn: () => Promise<void> | void) => Promise<void>;
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const flush = async (n = 20) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

jest.setTimeout(60_000);

describe('the auto-listen gate', () => {
  const { autoListenMayHoldMic } = require('../../services/voice/autoListenGate') as typeof import('../../services/voice/autoListenGate');
  const base = { autoListen: true, localMode: false, roundActive: true, appActive: true, tabVoiceState: 'idle', sessionState: 'idle', vadOwnsTurn: false, smartMotion: false };

  it('THE BUG: closes for every state of a badge / bottom-bar / earbud session', () => {
    for (const sessionState of ['opening', 'listening', 'thinking', 'responding']) {
      expect(autoListenMayHoldMic({ ...base, sessionState })).toBe(false);
    }
    expect(autoListenMayHoldMic(base)).toBe(true);
  });

  it("stays open through VAD's own turn, and only that 'listening'", () => {
    expect(autoListenMayHoldMic({ ...base, tabVoiceState: 'listening', vadOwnsTurn: true })).toBe(true);
    // The tab's tap-to-talk 'listening' (or arming / thinking) still owns the mic.
    expect(autoListenMayHoldMic({ ...base, tabVoiceState: 'listening' })).toBe(false);
    expect(autoListenMayHoldMic({ ...base, tabVoiceState: 'arming', vadOwnsTurn: true })).toBe(false);
  });

  it('is the gate the Caddie tab renders', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../app/(tabs)/caddie.tsx'), 'utf8') as string;
    expect(src).toMatch(/const vadEnabled = autoListenMayHoldMic\(\{[\s\S]*?sessionState: earbudState, vadOwnsTurn,/);
    expect(src).toMatch(/onSpeechAbandoned: \(\) => \{\s*setVadOwnsTurn\(false\);/);
  });
});

describe('the auto-listen recorder, driven', () => {
  const vs = jest.requireActual('../../services/voiceService') as typeof import('../../services/voiceService');
  const { useVoiceActivityDetection } = require('../../hooks/useVoiceActivityDetection') as typeof import('../../hooks/useVoiceActivityDetection');

  function mount(enabled: boolean) {
    const calls = { start: 0, end: 0, abandoned: 0 };
    const Probe = (p: { enabled: boolean }): null => {
      useVoiceActivityDetection({
        enabled: p.enabled,
        onSpeechStart: () => { calls.start += 1; },
        onSpeechEnd: () => { calls.end += 1; },
        onSpeechAbandoned: () => { calls.abandoned += 1; },
      } as Parameters<typeof useVoiceActivityDetection>[0]);
      return null;
    };
    let r: Renderer | null = null;
    return {
      calls,
      async render(on = enabled) {
        await rtrAct(async () => {
          if (r) r.update(createElement(Probe, { enabled: on }));
          else r = create(createElement(Probe, { enabled: on }));
          await flush();
        });
      },
      async unmount() { await rtrAct(async () => { r?.unmount(); await flush(); }); },
    };
  }
  const speak = (rec: { push: (s: Status) => void }) => {
    for (let i = 0; i < 3; i++) rec.push({ isRecording: true, metering: -60 });
    for (let i = 0; i < 4; i++) rec.push({ isRecording: true, metering: -20 });
  };

  beforeEach(() => { mockAv.live = []; mockSession.state = 'idle'; mockSession.inFlight = false; });

  it('a session can take the mic back: the handover stops the idle VAD recorder', async () => {
    const h = mount(true);
    await h.render();
    expect(mockAv.live).toHaveLength(1);
    // Waiting for speech is not a turn: proactive lines and supersede checks must not see a holder.
    expect(vs.isExternalMicActive()).toBe(false);
    mockSession.inFlight = true; mockSession.state = 'opening';   // the badge tap
    const verdict = await vs.releaseExternalMic();
    expect(mockAv.live[0].stopped).toBe(true);
    expect(verdict).toBe('discarded');
    await h.unmount();
  });

  it('never restarts under a live session', async () => {
    mockSession.inFlight = true; mockSession.state = 'listening';
    const h = mount(true);
    await h.render();
    expect(mockAv.live).toHaveLength(0);
    await h.unmount();
  });

  it('a player mid-sentence is a mic holder, and the handover submits his words', async () => {
    const h = mount(true);
    await h.render();
    speak(mockAv.live[0]);
    expect(h.calls.start).toBe(1);
    expect(vs.isExternalMicActive()).toBe(true);
    // Past the minimum utterance — real words, not a click.
    const realNow = Date.now; const t0 = realNow();
    Date.now = () => t0 + 1_000;
    try {
      mockSession.inFlight = true; mockSession.state = 'opening';
      const verdict = await vs.releaseExternalMic();
      expect(verdict).toBe('submitted');
      expect(h.calls.end).toBe(1);
      await flush();
      expect(mockAv.live).toHaveLength(1);   // and no restart while the session holds the mic
    } finally { Date.now = realNow; }
    await h.unmount();
  });

  it('a turn the gate cuts off is reported, so the avatar never sticks on listening', async () => {
    const h = mount(true);
    await h.render();
    speak(mockAv.live[0]);
    expect(h.calls.start).toBe(1);
    await h.render(false);                   // a session opened: the gate closes mid-utterance
    expect(mockAv.live[0].stopped).toBe(true);
    expect(h.calls.abandoned).toBe(1);
    expect(h.calls.end).toBe(0);
    await h.unmount();
  });

  it('a sound too short to be a word is dropped and VAD listens again', async () => {
    const h = mount(true);
    await h.render();
    const realNow = Date.now; let clock = realNow();
    Date.now = () => clock;
    try {
      speak(mockAv.live[0]);
      mockAv.live[0].push({ isRecording: true, metering: -60 });   // quiet → TRAILING
      clock += 3_000;                                               // past the silence window
      mockAv.live[0].push({ isRecording: true, metering: -60 });
      await rtrAct(async () => { await flush(); });
      expect(h.calls.abandoned).toBe(1);
      expect(h.calls.end).toBe(0);
      expect(mockAv.live).toHaveLength(2);                           // restarted
    } finally { Date.now = realNow; }
    await h.unmount();
  });
});
