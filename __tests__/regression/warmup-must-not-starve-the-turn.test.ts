/**
 * 2026-08-12 (Tim, correcting me — and he was right to) — "You're running with a really weak theory.
 * There is no weak signal. I'm sitting in a house with WiFi… we keep running the weak signal shit,
 * but my phone's always on 5G."
 *
 * I had blamed his network twice. The log said otherwise, and I should have read it properly the
 * first time. Three transcribe failures, minutes apart, against a server I measured at 237ms:
 *
 *   ping  5014 / 5016 / 5014 ms   against our 5000ms budget
 *   get   6017 / 6017 / 6016 ms   against our 6000ms budget
 *   total 11042 / 11043 / 11043 ms
 *
 * TWO MILLISECONDS of variance across three attempts minutes apart, each landing 14-17ms past OUR
 * OWN timeout. Networks do not fail with that precision. That is a client-side timer counting down
 * on a request that never reached the network — and we were the reason it never reached it.
 *
 * React Native on Android uses OkHttp, whose Dispatcher caps concurrent requests PER HOST at five.
 * WARMUP_PATHS is exactly five POSTs to one host, each with a 15-second budget — enough to occupy
 * the entire per-host pool alone. And `prewarmVoice(true)` fired five MORE at the instant the user
 * tapped the mic, deliberately, to "heat the chain overlapping the speech window".
 *
 * So the optimisation added to make the first turn fast was starving the first turn. It explains
 * every part of the symptom: always the FIRST turn (warmups only run then), always ~11s (our two
 * budgets back to back), and the second attempt works because by then the warmups have drained.
 *
 * The lesson worth keeping: when failure timings match your own constants to the millisecond, the
 * caller is the problem. Reaching for "bad signal" is the theory that requires no evidence.
 */
import fs from 'fs';
import path from 'path';

const read = (p: string) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const warm = read('services/voiceWarmup.ts');
const vc = read('hooks/useVoiceCaddie.ts');
const ls = read('services/listeningSession.ts');

describe('warmup can never occupy the whole per-host connection pool', () => {
  it('caps its own concurrency below OkHttp per-host limit of 5', () => {
    const m = /const WARMUP_CONCURRENCY = (\d+);/.exec(warm);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeLessThan(5);
    expect(Number(m![1])).toBeGreaterThan(0);
  });

  it('drains a queue rather than firing every path at once', () => {
    // Promise.all over all five paths is exactly what saturated the pool.
    expect(warm).not.toMatch(/Promise\.all\(WARMUP_PATHS\.map\(warmup\)\)/);
    expect(warm).toContain('const queue = [...WARMUP_PATHS];');
  });

  it('holds a connection for far less time than a user will wait', () => {
    const m = /const WARMUP_TIMEOUT_MS = (\d+)_?(\d*);/.exec(warm);
    expect(m).not.toBeNull();
    const ms = Number(`${m![1]}${m![2] ?? ''}`);
    expect(ms).toBeLessThanOrEqual(8000);
    expect(warm).not.toContain('AbortSignal.timeout(15_000)');
  });
});

describe('a real turn RELEASES warmup connections instead of adding more', () => {
  it('exposes an abort', () => {
    expect(warm).toContain('export function abortVoiceWarmup(): void');
    expect(warm).toContain('warmupAbort.abort()');
  });

  it('warmup fetches are actually cancellable — an abort with no signal does nothing', () => {
    expect(warm).toContain('AbortSignal.any([signal, AbortSignal.timeout(WARMUP_TIMEOUT_MS)])');
  });

  /** A real CALL, not a mention of it in a comment explaining why it was removed. */
  const callsForceWarm = (src: string) =>
    src.split('\n').some(l => !l.trim().startsWith('*') && !l.trim().startsWith('//') && l.includes('prewarmVoice(true)'));

  it('the on-screen mic aborts instead of force-warming', () => {
    expect(vc).toContain('abortVoiceWarmup()');
    // The exact call that caused it: five more POSTs at tap time.
    expect(callsForceWarm(vc)).toBe(false);
  });

  it('the earbud / global-mic path does the same', () => {
    expect(ls).toContain('abortVoiceWarmup()');
    expect(callsForceWarm(ls)).toBe(false);
  });

  it('still warms on foreground, where there is no turn to compete with', () => {
    // Warming is genuinely useful — it just must not run against the user.
    expect(vc).toContain('prewarmVoice()');
  });
});
