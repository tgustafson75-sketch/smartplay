/**
 * 2026-09-12 (Tim, on device) — "Kevin is stuck listening after a question from him I answered."
 *
 * THE RACE. On 2026-09-11 the caddie tab started opening the mic when its opener ended on a question
 * (Tim: "he greets with a question but doesn't listen… Pinocchio instead of a real boy"). The effect
 * fires `void toggle()` and then, a few lines later, `primeMicPipeline()` — a first-tap warm-up that
 * has been there since 2026-06-16 and was always safe, because until that change nothing left a
 * session open behind it.
 *
 * primeMicPipeline guarded on `isCapturing()`. That only goes true once the recording actually
 * starts, several awaits deep inside openSession(). So in the window between "session opening" and
 * "recording started", priming sailed through, created a SECOND Audio.Recording next to the real
 * one, and — the part that actually broke it — ran `configureAudioForSpeech()` in its `finally`,
 * putting the audio session back into speech mode underneath a session trying to record.
 *
 * The capture then records nothing, VAD never sees end-of-speech, and the turn never ends. The
 * session sits in 'listening' for the full DORMANCY_MAX_MS (150s) before the watchdog force-closes
 * it. From the outside: Kevin asks, you answer, and he just keeps listening.
 *
 * WHY THE FIX IS RACE-FREE, not merely narrower: `sessionInFlight` is assigned SYNCHRONOUSLY at the
 * top of toggle(), before its first await. A caller that does `void toggle()` and then primes in the
 * same tick therefore always observes it as true.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const code = (rel: string) =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const VOICE = code('services/voiceService.ts');
const SESSION = read('services/listeningSession.ts');

describe('priming never runs underneath a live or opening session', () => {
  it('primeMicPipeline bails when a listening session is in flight', () => {
    const at = VOICE.indexOf('export async function primeMicPipeline');
    expect(at).toBeGreaterThan(-1);
    const body = VOICE.slice(at, at + 1400);
    expect(body).toMatch(/isSessionInFlight\(\)/);
    // and it must bail BEFORE it touches the audio route or creates a recording
    const bail = body.indexOf('isSessionInFlight()');
    expect(bail).toBeLessThan(body.indexOf('configureAudioForRecording'));
    expect(bail).toBeLessThan(body.indexOf('Audio.Recording.createAsync'));
  });

  it('keeps the older guards too — this narrowed nothing', () => {
    const at = VOICE.indexOf('export async function primeMicPipeline');
    const body = VOICE.slice(at, at + 1400);
    expect(body).toMatch(/isSpeaking\(\) \|\| isCapturing\(\)/);
  });

  it('still restores speech mode on the way out, for the runs that DO prime', () => {
    const at = VOICE.indexOf('export async function primeMicPipeline');
    const body = VOICE.slice(at, at + 1800);
    expect(body).toMatch(/finally \{[\s\S]*?configureAudioForSpeech/);
  });
});

describe('the flag the fix depends on is set synchronously', () => {
  /**
   * If an await ever lands above `sessionInFlight = true`, the guard above degrades from
   * race-FREE to merely race-narrower and this bug comes back intermittently — the worst way.
   */
  it('toggle() sets sessionInFlight before its first await', () => {
    const at = SESSION.indexOf('export async function toggle()');
    expect(at).toBeGreaterThan(-1);
    const body = SESSION.slice(at, SESSION.indexOf('await openSession();', at));
    const stripped = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(stripped).toContain('sessionInFlight = true;');
    const flagAt = stripped.indexOf('sessionInFlight = true;');
    const firstAwait = stripped.indexOf('await ');
    // no await at all before the flag, or the first one comes after it
    expect(firstAwait === -1 || firstAwait > flagAt).toBe(true);
  });

  it('isSessionInFlight is exported, so the guard can actually read it', () => {
    expect(SESSION).toMatch(/export function isSessionInFlight\(\): boolean/);
  });
});

describe('the tab no longer arms the mic at all — belt AND braces', () => {
  const TAB = code('app/(tabs)/caddie.tsx');

  /**
   * 2026-09-12, later the same day: Tim removed the trigger as well. "Just don't start with a
   * question as a rule — make it more statement based." The opener is now an offer, so nothing
   * opens the mic and this specific collision cannot be staged any more.
   *
   * The guard above STAYS regardless. It is not a fix for one call site; primeMicPipeline is
   * exported and any future caller that opens a session and primes in the same tick would walk into
   * exactly the same teardown. The call site that happened to find it is gone; the trap was not.
   */
  it('the opener does not open a listening session', () => {
    expect(TAB).not.toMatch(/ls\.toggle\(\)/);
  });

  it('still primes — the warm-up is wanted on every launch, and now always safely', () => {
    expect(TAB).toMatch(/primeMicPipeline\(\)/);
  });

  it('and the guard is in primeMicPipeline itself, not at the call site that tripped it', () => {
    expect(TAB).not.toMatch(/isSessionInFlight/);
    expect(VOICE).toMatch(/isSessionInFlight\(\)/);
  });
});
