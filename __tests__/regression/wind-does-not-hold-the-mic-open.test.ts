/**
 * 2026-10-17 — Tim at the range, in wind: "caddie had a hard time stop listening when I was done".
 * services/voice/endpointer is now the one end-of-speech detector for the Caddie tab (useVoiceCaddie)
 * and the earbud / text-box mic (voiceService). Behavioural: metering traces at 100ms, the way both
 * call sites feed it. Noise is a seeded pseudo-random walk, so the traces are fixed.
 */
import { createEndpointer, NOISY_CAP_MS, type EndReason } from '../../services/voice/endpointer';

const CFG = { shortMs: 1500, longMs: 2400, speechLongMs: 700 };

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** Speech: syllables at `level` with short dips toward `gapTo` every ~250ms. */
const speech = (ms: number, level: number, gapTo: number, r: () => number) =>
  Array.from({ length: ms / 100 }, (_, i) => (i % 3 === 2 ? gapTo + r() * 4 : level + (r() * 6 - 3)));
const flat = (ms: number, level: number, jitter: number, r: () => number) =>
  Array.from({ length: ms / 100 }, () => level + (r() * 2 - 1) * jitter);
/** Gusty wind: a slow walk between lull and gust levels, gusts lasting ~0.5-2s. */
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

/** Run a trace; returns when (ms after the mic opened) and why it ended, or null at the end of the trace. */
function run(trace: number[], hardCapMs = 18_000): { atMs: number; reason: EndReason | 'cap' } | null {
  const ep = createEndpointer(CFG);
  ep.markLoud(0);
  for (let i = 0; i < trace.length; i++) {
    const t = i * 100;
    ep.push(trace[i], t);
    const why = ep.shouldStop(t, 0);
    if (why) return { atMs: t, reason: why };
    if (t >= hardCapMs) return { atMs: t, reason: 'cap' };
  }
  return null;
}

describe('quiet room — unchanged', () => {
  it('a 2s question at -20 over -55 ends about 2.4s after the last word', () => {
    const r = rng(1);
    const trace = [...flat(500, -55, 2, r), ...speech(2000, -20, -50, r), ...flat(6000, -55, 2, r)];
    const out = run(trace)!;
    expect(out.reason).toBe('silence');
    expect(out.atMs).toBeGreaterThanOrEqual(2500 + 2200);
    expect(out.atMs).toBeLessThanOrEqual(2500 + 2700);
  });

  it('a 1.5s word-search pause mid-sentence does not cut the player off', () => {
    const r = rng(2);
    const trace = [...flat(300, -55, 2, r), ...speech(1500, -22, -50, r), ...flat(1500, -55, 2, r), ...speech(1500, -22, -50, r), ...flat(5000, -55, 2, r)];
    expect(run(trace)!.atMs).toBeGreaterThan(300 + 1500 + 1500 + 1500);
  });

  it('a quiet talker (-36 over -55) still ends on silence, and is never cut off mid-sentence', () => {
    const r = rng(3);
    // -36 never crosses the -30 speech bar: as before, no speech is "heard" and the caller's no-speech
    // stand-down owns it — the endpointer neither ends it early nor caps it.
    const trace = [...flat(300, -55, 2, r), ...speech(3000, -36, -52, r), ...flat(4000, -55, 2, r)];
    expect(run(trace)).toBeNull();
  });
});

describe('noise — the wind no longer holds the mic open', () => {
  it('steady noise at -32 (a cart, a crowd): ends within 3s of the last word, not at the cap', () => {
    const r = rng(4);
    const trace = [...flat(500, -32, 2, r), ...speech(2500, -10, -30, r), ...flat(12_000, -32, 2, r)];
    const out = run(trace)!;
    expect(out.reason).toBe('silence');
    expect(out.atMs).toBeLessThanOrEqual(3000 + 3000);
    expect(out.atMs).toBeGreaterThan(3000);           // not before the player finished
  });

  it('gusty wind (lulls -38, gusts -20), voice at -8: ends within 3.5s of the last word', () => {
    const r = rng(5);
    const trace = [...wind(600, -38, -20, r), ...speech(2500, -8, -30, r), ...wind(12_000, -38, -20, r)];
    const out = run(trace)!;
    expect(out.atMs).toBeGreaterThan(3100);
    expect(out.atMs).toBeLessThanOrEqual(3100 + 3500);
  });

  it('wind as loud as the voice: the noisy cap ends it at 8s, not 18s', () => {
    const r = rng(6);
    const trace = [...wind(500, -25, -6, r), ...speech(2500, -8, -24, r), ...wind(16_000, -25, -6, r)];
    const out = run(trace)!;
    expect(out.atMs).toBeLessThanOrEqual(NOISY_CAP_MS);
  });

  it('in noise, a 1s pause mid-question does not cut the player off', () => {
    const r = rng(7);
    const trace = [...flat(500, -32, 2, r), ...speech(1500, -10, -30, r), ...flat(1000, -32, 2, r), ...speech(1500, -10, -30, r), ...flat(6000, -32, 2, r)];
    expect(run(trace)!.atMs).toBeGreaterThan(500 + 1500 + 1000 + 1500);
  });

  it('a player who starts talking the instant the mic opens is still heard and still ended', () => {
    const r = rng(8);
    const trace = [...speech(2500, -10, -32, r), ...flat(8000, -32, 2, r)];
    const out = run(trace)!;
    expect(out.reason).toBe('silence');
    expect(out.atMs).toBeGreaterThan(2500);
    expect(out.atMs).toBeLessThanOrEqual(2500 + 3000);
  });
});

describe('the -160 no-signal sentinel and missing readings', () => {
  it('cold-mic -160 readings are ignored, not taken as ambient', () => {
    const r = rng(9);
    const trace = [-160, -160, -160, ...flat(500, -55, 2, r), ...speech(2000, -20, -50, r), ...flat(4000, -55, 2, r)];
    expect(run(trace)!.reason).toBe('silence');
  });
});

/**
 * The Caddie tab (hooks/useVoiceCaddie) ended on a fixed -40 dBFS and ran to its 18s cap in wind. It has
 * no render harness (a 3,000-line hook over native audio), so this pins that it feeds and asks the SAME
 * endpointer the traces above exercise — and that no fixed-threshold endpoint is left beside it.
 */
describe('the Caddie tab ends on the same detector', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../../hooks/useVoiceCaddie.ts'), 'utf8') as string;
  it('feeds every metering reading to it and asks it in the poll', () => {
    expect(src).toMatch(/const ep = createEndpointer\(\{ shortMs: MIC_SILENCE_SHORT_MS, longMs: MIC_SILENCE_LONG_MS, speechLongMs: MIC_SPEECH_LONG_MS \}\);/);
    expect(src).toMatch(/meterTracker\.update\(metering\);\s*ep\.push\(metering, Date\.now\(\)\);/);
    expect(src).toMatch(/const endWhy = ep\.shouldStop\(Date\.now\(\), recordStartedAt\);\s*if \(endWhy\) \{[\s\S]{0,300}void hardStopAndProcess\(\)/);
  });
  it('no fixed -40 / -30 endpoint is left beside it', () => {
    expect(src).not.toMatch(/MIC_SILENCE_DB_THRESHOLD|MIC_SPEECH_DETECT_DB|micLastLoudAt/);
  });
});
