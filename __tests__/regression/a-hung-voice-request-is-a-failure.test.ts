/**
 * 2026-10-28 (recheck VOICE-ENG-R3-1) — WHEN /api/voice HANGS PAST ITS 20 s BUDGET, THE LINE WENT SILENT.
 *
 * Weak 1-bar signal: the request never gets headers back, speak()'s own 20 s budget aborts it, and the
 * resulting AbortError was read as "a newer utterance preempted us". So the player waited 20 s and
 * heard nothing — not even the cached real-voice "trouble connecting" clip on disk, the line made for
 * exactly this link — and nothing was logged or counted. A genuine preemption claims a new speech id
 * before it aborts; a budget abort does not, and that is the difference speak() now reads.
 *
 * The no-robot-voice rule is unchanged: a line with no recording stays silent (logged).
 */
const mockExists = { fn: (_name: string) => false };
jest.mock('expo-file-system', () => {
  class File {
    name: string; uri: string;
    constructor(_dir: unknown, name: string) { this.name = name; this.uri = `file:///cache/${name}`; }
    get exists() { return mockExists.fn(this.name); }
    get size() { return mockExists.fn(this.name) ? 24_000 : 0; }
    write() { /* not needed */ }
  }
  return { File, Paths: { cache: {} } };
});
const mockPlayed: string[] = [];
jest.mock('expo-av', () => {
  const base = jest.requireActual('../mocks/expoAv.js');
  const sound = {
    playAsync: async () => ({ isLoaded: true }),
    stopAsync: async () => undefined,
    unloadAsync: async () => undefined,
    setPositionAsync: async () => undefined,
    setVolumeAsync: async () => undefined,
    getStatusAsync: async () => ({ isLoaded: true, durationMillis: 800, didJustFinish: true }),
    setOnPlaybackStatusUpdate: (cb: ((s: unknown) => void) | null) => { if (cb) setTimeout(() => cb({ isLoaded: true, didJustFinish: true, durationMillis: 800 }), 0); },
  };
  const Sound = { createAsync: async (src: { uri?: string } | number) => {
    mockPlayed.push(typeof src === 'object' && src ? String(src.uri) : String(src));
    return { sound, status: { isLoaded: true, durationMillis: 800 } };
  } };
  const Audio = new Proxy(base.Audio, { get: (t, prop) => (prop === 'Sound' ? Sound : t[prop]) });
  return new Proxy(base, { get: (t, prop) => (prop === 'Audio' ? Audio : t[prop]) });
});
const mockEvents: { stage: string }[] = [];
jest.mock('../../store/issueLogStore', () => ({
  useIssueLogStore: { getState: () => ({
    addAppEvent: (stage: string) => mockEvents.push({ stage }),
    addVoiceEvent: (_kind: string, stage: string) => mockEvents.push({ stage }),
  }) },
}));

import { speak, stopSpeaking } from '../../services/voiceService';
import { __resetOfflineVoiceCache } from '../../services/offlineVoiceCache';
import { CADDIE_NOTICE_CONNECTION } from '../../services/caddieAckLines';
import { getCircuitBreakerSnapshot } from '../../services/voiceCircuitBreaker';

const CONNECTION = CADDIE_NOTICE_CONNECTION.en;

/** A request that never answers: it only ends when its signal aborts it. */
function hangingFetch(): jest.Mock {
  return jest.fn((_url: string, init?: { signal?: AbortSignal }) => new Promise((_res, rej) => {
    init?.signal?.addEventListener('abort', () => {
      const e = new Error('Aborted'); e.name = 'AbortError'; rej(e);
    });
  }));
}

beforeEach(() => {
  __resetOfflineVoiceCache();
  mockEvents.length = 0;
  mockPlayed.length = 0;
  mockExists.fn = () => false;
  jest.useFakeTimers();
  global.fetch = hangingFetch() as unknown as typeof fetch;
});
afterEach(() => { jest.useRealTimers(); });

describe('a hung /api/voice request is a failure, not a preemption', () => {
  it('THE BUG: past the 20 s budget the cached "trouble connecting" clip plays', async () => {
    mockExists.fn = (n) => n.startsWith('offline_voice_kevin_male_notice_connection_en_');
    const before = getCircuitBreakerSnapshot().failureCount.voice;
    const p = speak(CONNECTION, 'male', 'en', 'http://localhost:9', { userInitiated: true });
    await jest.advanceTimersByTimeAsync(20_500);
    await p;
    expect(mockPlayed.some((u) => /offline_voice_kevin_male_notice_connection_en_/.test(u))).toBe(true);
    expect(mockEvents.map((e) => e.stage)).toContain('speak_timeout');
    // Counted, so the breaker sees hangs (it was blind to them).
    const after = getCircuitBreakerSnapshot();
    expect(after.failureCount.voice + (after.degraded.voice ? 3 : 0)).toBeGreaterThan(before);
  });

  it('a hung line with no recording is logged, and the device voice never speaks', async () => {
    const p = speak('152 yards to the middle of the green.', 'male', 'en', 'http://localhost:9', { userInitiated: true });
    await jest.advanceTimersByTimeAsync(20_500);
    await p;
    expect(mockPlayed).toEqual([]);
    const stages = mockEvents.map((e) => e.stage);
    expect(stages).toContain('speak_timeout');
    expect(stages).toContain('voice_device_tts_suppressed');
  });

  it('a real preemption (stop) still stays silent and logs nothing as a failure', async () => {
    mockExists.fn = (n) => n.startsWith('offline_voice_kevin_male_notice_connection_en_');
    const p = speak(CONNECTION, 'male', 'en', 'http://localhost:9', { userInitiated: true });
    await jest.advanceTimersByTimeAsync(1_000);
    await stopSpeaking();
    await jest.advanceTimersByTimeAsync(20_500);
    await p;
    expect(mockPlayed).toEqual([]);
    expect(mockEvents.map((e) => e.stage)).not.toContain('speak_timeout');
  });
});
