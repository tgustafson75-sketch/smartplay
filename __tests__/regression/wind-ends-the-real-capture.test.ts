/**
 * 2026-10-17 — Tim at the range, in wind: "caddie had a hard time stop listening when I was done".
 * The real captureUtteranceDetailed (earbud / text-box mic), driven with metering readings through the
 * recording's status callback. Only the native edges (expo-av, the file system, the network) are stubbed.
 * The endpointer's own traces are in wind-does-not-hold-the-mic-open.test.ts.
 */
const mockRec = { cb: null as null | ((s: { isRecording: boolean; metering?: number }) => void), stoppedAt: -1, startedAt: 0 };

jest.mock('expo-av', () => {
  const leaf = new Proxy({}, { get: (_t, p) => String(p) });
  return {
    __esModule: true,
    InterruptionModeIOS: leaf,
    InterruptionModeAndroid: leaf,
    Audio: {
      AndroidOutputFormat: leaf, AndroidAudioEncoder: leaf, IOSOutputFormat: leaf, IOSAudioQuality: leaf,
      requestPermissionsAsync: async () => ({ granted: true }),
      setAudioModeAsync: async () => undefined,
      Sound: { createAsync: async () => ({ sound: { unloadAsync: async () => undefined, stopAsync: async () => undefined } }) },
      Recording: {
        createAsync: async (_o: unknown, cb: typeof mockRec.cb) => {
          mockRec.cb = cb;
          mockRec.startedAt = Date.now();
          return {
            recording: {
              getURI: () => 'file:///capture.m4a',
              getStatusAsync: async () => ({ durationMillis: Date.now() - mockRec.startedAt }),
              stopAndUnloadAsync: async () => { mockRec.stoppedAt = Date.now() - mockRec.startedAt; },
            },
          };
        },
      },
    },
  };
});
jest.mock('expo-file-system/legacy', () => ({ getInfoAsync: async () => ({ exists: true, size: 40_000 }) }));

import { captureUtteranceDetailed } from '../../services/voiceService';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
const speech = (ms: number, level: number, gapTo: number, r: () => number) =>
  Array.from({ length: ms / 100 }, (_, i) => (i % 3 === 2 ? gapTo + r() * 4 : level + (r() * 6 - 3)));
function wind(ms: number, lull: number, gust: number, r: () => number) {
  const out: number[] = [];
  let target = lull, cur = lull;
  for (let i = 0; i < ms / 100; i++) {
    if (r() < 0.12) target = r() < 0.5 ? lull + r() * 4 : gust - r() * 6;
    cur += (target - cur) * 0.5;
    out.push(cur + (r() * 4 - 2));
  }
  return out;
}

beforeEach(() => {
  mockRec.cb = null; mockRec.stoppedAt = -1;
  (globalThis as { fetch?: unknown }).fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ text: 'what should I hit from 150' }), text: async () => '' }));
});
afterEach(() => jest.useRealTimers());

async function drive(trace: number[], timeoutMs: number) {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  const p = captureUtteranceDetailed(timeoutMs, 'https://api.test');
  for (let i = 0; i < 50 && !mockRec.cb; i++) await jest.advanceTimersByTimeAsync(10);
  expect(mockRec.cb).not.toBeNull();
  for (const m of trace) {
    if (mockRec.stoppedAt >= 0) break;
    mockRec.cb!({ isRecording: true, metering: m });
    await jest.advanceTimersByTimeAsync(100);
  }
  await jest.advanceTimersByTimeAsync(timeoutMs);
  return p;
}

describe('the earbud / text-box capture ends in wind', () => {
  it('gusty wind (lulls -38, gusts -20), voice -8 for 2.5s: ends within ~3.5s of the last word, well before the 8s cap', async () => {
    const r = rng(5);
    const trace = [...wind(600, -38, -20, r), ...speech(2500, -8, -30, r), ...wind(12_000, -38, -20, r)];
    const out = await drive(trace, 8_000);
    expect(out.heardSpeech).toBe(true);
    expect(mockRec.stoppedAt).toBeGreaterThan(3_100);
    expect(mockRec.stoppedAt).toBeLessThan(3_100 + 3_700);
    expect(out.text).toBe('what should I hit from 150');
  });

  it('a quiet room still ends on its silence window (unchanged)', async () => {
    const r = rng(1);
    const quiet = (ms: number) => Array.from({ length: ms / 100 }, () => -55 + (r() * 4 - 2));
    const trace = [...quiet(500), ...speech(2000, -20, -50, r), ...quiet(6000)];
    await drive(trace, 8_000);
    expect(mockRec.stoppedAt).toBeGreaterThan(2_500 + 2_100);
    expect(mockRec.stoppedAt).toBeLessThan(2_500 + 2_900);
  });

  it('a soft voice (-24) in steady wind (-35) counts as heard, so a tap submits it rather than discarding', async () => {
    const r = rng(10);
    const flat = (ms: number, level: number) => Array.from({ length: ms / 100 }, () => level + (r() * 4 - 2));
    const trace = [...flat(500, -35), ...speech(3000, -24, -35, r), ...flat(10_000, -35)];
    const out = await drive(trace, 8_000);
    expect(out.heardSpeech).toBe(true);
  });
});
