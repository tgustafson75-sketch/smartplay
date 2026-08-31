import * as fs from 'fs';
import * as path from 'path';
const readRaw = (r: string) => fs.readFileSync(path.resolve(__dirname, '../../', r), 'utf-8');
/**
 * 2026-08-31 — COMMENTS STRIPPED. This file forbids `Speech.speak(` in the source, and it began
 * failing the moment voiceService's header was corrected to say — in prose — that `Speech.speak(`
 * appears nowhere. A file's account of what it does not do is not it doing the thing. That was the
 * FOURTH time in one session a guard here was defeated by prose naming the very token it forbids,
 * so the strip is the fix rather than rewording the comment.
 * [[a-stale-header-is-a-source-someone-trusts]] [[break-test-every-guard-you-write]]
 */
const read = (r: string) =>
  readRaw(r).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(?<![:\w])\/\/[^\n]*/g, ' ');

/**
 * 2026-08-22 (Tim, after a round at Greenhill) — "fuck local altogether. I don't wanna fucking hear
 * a robot voice anymore. Rip it out. I don't wanna ever hear it again."
 */
describe('the caddie has one voice', () => {
  const v = read('services/voiceService.ts');
  const from = v.indexOf('async function deviceSpeakFallback(');
  const fn = v.slice(from, v.indexOf('\n}', from) + 2);

  it('the choke point survives, so its nine callers keep working', () => {
    // Enforced in ONE place rather than by deleting call sites — a tenth caller would have
    // reintroduced it.
    expect(from).toBeGreaterThan(-1);
    expect((v.match(/deviceSpeakFallback\(/g) ?? []).length).toBeGreaterThan(5);
  });

  it('but nothing can make the device speak', () => {
    expect(fn).not.toMatch(/Speech\.speak\(/);
    expect(v).not.toMatch(/Speech\.speak\(/);
  });

  it('the voice-selection machinery is DELETED, not left unreachable', () => {
    // Dead code behind a return is a band-aid; it also silently rots.
    expect(v).not.toMatch(/function pickDeviceVoice\(/);
    expect(v).not.toMatch(/Speech\.getAvailableVoicesAsync\(\)/);
    expect(v).not.toMatch(/no-unreachable/);
  });

  it('a silent turn is still explainable in the issue log', () => {
    expect(fn).toMatch(/voice_device_tts_suppressed/);
    expect(fn).toMatch(/'diag'/);   // on-device breadcrumb, not a mailed error
  });

  it("the persona's own cached clips still play — that is the REAL voice, not a robot", () => {
    expect(v).toMatch(/resolveCachedOfflineClipUri/);
    expect(v).toMatch(/prewarmOfflineVoiceClips/);
  });
});

describe('listening does not run on and collect the course', () => {
  it('caps one listen well under the old 12s', () => {
    const ls = read('services/listeningSession.ts');
    expect(ls).toMatch(/const MAX_UTTERANCE_MS = 8_000;/);
    expect(ls).toMatch(/captureUtteranceDetailed\(MAX_UTTERANCE_MS,/);
    expect(ls).not.toMatch(/captureUtteranceDetailed\(12_000,/);
  });
});
