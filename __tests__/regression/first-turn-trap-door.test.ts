/**
 * 2026-08-12 (Tim, testing on 5G) — "First time talking to Caddie is still a fail months later. I
 * really believe it probes for a live round, takes a trip before warm up and has an initial trap
 * door… Don't believe my theory, evaluate from code the whole start up method."
 *
 * Evaluated. The trap door is real, and it is not in the network path at all — which is why months
 * of network fixes never touched it.
 *
 * handleMicPress treated ANY tap during speech as "interrupt": stop the audio, RETURN, never open
 * the mic. That is correct when the caddie is answering something you asked — you tapped to shut it
 * up. It is wrong when the caddie spoke FIRST, because then the tap means "I'm answering you", and
 * the turn was silently eaten. Tap, voice stops, nothing happens, tap again.
 *
 * A cold launch is exactly when this bites. Boot routes through /greeting, which speaks; the Caddie
 * tab then opens with proactive speech of its own (the get-to-know opener, persona opener,
 * briefings, nudges). So the FIRST tap of a session is the one most likely to land during
 * unsolicited speech — "the first time is always a fail", with a perfectly healthy backend.
 *
 * A real caddie mid-sentence, when you start talking, stops and listens. They don't stop and stare.
 *
 * The second half is his signal point: "If verified signal, guard error states." The app can't read
 * the radio (NetInfo/expo-network are native modules; adding one breaks OTA on installs in the
 * field) — but every cloud round-trip already measures whether OUR host answers, which is the part
 * that matters. That measurement was being thrown away.
 */
import fs from 'fs';
import path from 'path';

const read = (p: string) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');

describe('the first tap is never eaten', () => {
  const src = read('hooks/useVoiceCaddie.ts');

  it('distinguishes speech the user asked for from speech the caddie volunteered', () => {
    expect(src).toContain('isSpeakingUserInitiated');
    expect(src).toContain('if (isSpeaking() && !isSpeakingUserInitiated()) {');
  });

  it('a tap during UNSOLICITED speech falls through to open the mic', () => {
    const start = src.indexOf('if (isSpeaking() && !isSpeakingUserInitiated()) {');
    const branch = src.slice(start, src.indexOf('} else if (isSpeaking()) {', start));
    expect(branch).toContain('await stopSpeaking();');
    // THE fix: no early return in this branch. A `return` here is the bug itself.
    expect(branch).not.toMatch(/\n\s{6}return;/);
  });

  it('still suppresses the in-flight follow-up loop so it cannot reopen the mic underneath us', () => {
    const start = src.indexOf('if (isSpeaking() && !isSpeakingUserInitiated()) {');
    const branch = src.slice(start, src.indexOf('} else if (isSpeaking()) {', start));
    expect(branch).toContain('userInterruptedRef.current = true;');
  });

  it('a tap during a reply the user ASKED for still just interrupts', () => {
    // Tapping to shut up an answer you requested must not immediately demand more input.
    const elseBranch = src.slice(src.indexOf('} else if (isSpeaking()) {'));
    expect(elseBranch.slice(0, 900)).toContain('return;');
  });
});

describe('speech origin is recorded wherever audio actually starts', () => {
  const vs = read('services/voiceService.ts');

  it('exposes the distinction', () => {
    expect(vs).toContain('export const isSpeakingUserInitiated');
    expect(vs).toContain('export const markSpeechOrigin');
  });

  it('marks origin at EVERY playback site, not just one', () => {
    // speak(), speakFromBase64() and playLocalFile() all assign currentSound. Missing one leaves a
    // path where the trap door still shuts — the classic half-fix here.
    const assigns = vs.split('currentSound = sound;').length - 1;
    const marks = vs.split('markSpeechOrigin(!!opts?.userInitiated);').length - 1;
    expect(assigns).toBeGreaterThanOrEqual(3);
    expect(marks).toBe(assigns);
  });
});

describe('the app measures whether OUR host answers, and adjusts', () => {
  const api = read('services/apiBase.ts');

  it('keeps the evidence instead of collapsing it to a boolean', () => {
    expect(api).toContain('export function getConnectionEvidence()');
    expect(api).toContain('provenRecently');
    expect(api).toContain('export function noteRoundTripOk');
  });

  it('times the boot warm-up — the first look at the link', () => {
    const warm = api.slice(api.indexOf('export function warmBackendConnection'));
    expect(warm).toContain('const t0 = Date.now();');
    expect(warm).toContain('noteRoundTripOk(Date.now() - t0);');
  });

  it('every successful cloud round-trip refreshes the evidence', () => {
    const mark = api.slice(api.indexOf('export function markConnectionWarmed'));
    expect(mark.slice(0, 250)).toContain('noteRoundTripOk();');
  });

  it('is still boot-wired — the warm loop must actually run', () => {
    // A warm loop nobody calls is the failure mode this whole area had before.
    expect(read('app/_layout.tsx')).toContain('m.warmBackendConnection()');
  });
});

describe('error states do not blame a connection that is provably fine', () => {
  const ls = read('services/listeningSession.ts');

  it('picks the failure line from evidence, not reflex', () => {
    // Was: one line, "I'm having trouble connecting", spoken for EVERY failure in the module —
    // handler throw, empty brain reply, slow turn — while Tim had five bars.
    expect(ls).toContain('getConnectionEvidence().provenRecently ? FAILURE_ON_US : FAILURE_FALLBACK');
  });

  it('owns the failure when the host answered seconds ago', () => {
    expect(ls).toContain('FAILURE_ON_US');
    expect(ls).toContain("That one got away from me");
  });

  it('keeps a connection message for when the connection really is the problem', () => {
    expect(ls).toContain("I'm having trouble connecting");
  });

  it('covers every language the connection line had', () => {
    const onUs = ls.slice(ls.indexOf('const FAILURE_ON_US'), ls.indexOf('function failureFallbackFor'));
    for (const lang of ['en:', 'es:', 'zh:']) expect(onUs).toContain(lang);
  });
});
