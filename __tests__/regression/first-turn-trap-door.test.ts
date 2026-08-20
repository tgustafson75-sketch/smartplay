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
import { CADDIE_NOTICE_CONNECTION, CADDIE_NOTICE_ON_US } from '../../services/caddieAckLines';

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

  // 2026-08-17 — the wording moved to services/caddieAckLines so the TAP path can speak the same
  // lines: its aborted-transcribe branch was saying "Didn't catch that" for a connection failure.
  // Assert the shared source, and that this module still routes through it.
  it('owns the failure when the host answered seconds ago', () => {
    expect(ls).toContain('FAILURE_ON_US');
    expect(ls).toContain('CADDIE_NOTICE_ON_US');
    expect(CADDIE_NOTICE_ON_US.en).toContain('That one got away from me');
  });

  it('keeps a connection message for when the connection really is the problem', () => {
    expect(CADDIE_NOTICE_CONNECTION.en).toContain("I'm having trouble connecting");
    expect(ls).toContain('CADDIE_NOTICE_CONNECTION');
  });

  it('covers every language the connection line had', () => {
    for (const lang of ['en', 'es', 'zh'] as const) {
      expect(CADDIE_NOTICE_ON_US[lang].trim().length).toBeGreaterThan(0);
      expect(CADDIE_NOTICE_CONNECTION[lang].trim().length).toBeGreaterThan(0);
    }
  });

  it('speaks the connection line on the TAP path too, instead of blaming the mic', () => {
    // The aborted-transcribe branch in useVoiceCaddie used to say "Didn't catch that — say it
    // again?", which sends the player to repeat a sentence we already recorded successfully.
    const v = read('hooks/useVoiceCaddie.ts');
    const abortBranch = v.slice(v.indexOf("source: 'process_audio_abort'"), v.indexOf("logVoiceError('process_audio'"));
    expect(abortBranch).toContain('CADDIE_NOTICE_CONNECTION');
    expect(abortBranch).toContain('getConnectionEvidence().provenRecently');
    // The spoken line must no longer be the didn't-hear-you one (prose mentioning it is fine —
    // this looks at what is actually assigned to `line`).
    expect(abortBranch).not.toMatch(/const line = "Didn't catch that/);
  });
});

/**
 * 2026-08-12 (Tim, correcting my first diagnosis) — "this happened even if I didn't tap during
 * speech. This is when I just waited and did nothing then tapped and tried." And, unprompted:
 * "from the little mic indicator on my phone it has always seemed to, for a tiny second, indicate
 * the mic opens when the app starts, but I've never mentioned it."
 *
 * That indicator is the app opening the mic BY ITSELF. The Caddie tab's proactive opener calls
 * handleMicPress() in its .finally() — hands-free is the product, so it hands over the mic when it
 * stops talking. If nobody answers, that capture sits there recording silence, because the
 * silence-VAD endpoint requires micHasSpoken; with no speech, nothing closes it until the 18s cap.
 *
 * So: wait, then tap — and the tap lands on an OPEN recording and is read as "I'm done, process
 * this". Several seconds of silence go to Whisper, come back empty, and are reported as a failure.
 * The second tap starts fresh and works. That is "the first time is always a fail", and it happens
 * whether or not the user tapped during speech — which is exactly why my first fix (tap-during-
 * unsolicited-speech) was real but was NOT this.
 *
 * Same shape if the auto-opened recording died underneath us — an audio-session reconfigure from a
 * later speak() kills it, which is what a mic indicator flashing "for a tiny second" looks like.
 * stopAndUnloadAsync then throws and the old code went idle: the tap did literally nothing.
 */
describe('a tap that ends a capture which heard nothing means "start listening"', () => {
  const src = read('hooks/useVoiceCaddie.ts');

  it('the STOP branch can tell "heard someone" from "heard nothing"', () => {
    // micHasSpoken was a local inside the START closure, invisible to the stop path.
    expect(src).toContain('const micHasSpokenRef = useRef(false);');
    expect(src).toContain('micHasSpokenRef.current = true;');
    expect(src).toContain('micHasSpokenRef.current = false; // fresh capture — nothing heard yet');
  });

  /**
   * 2026-08-19 — THIS TEST ASSERTED THE OPPOSITE UNTIL THE FIELD SETTLED IT.
   *
   * It used to require that a capture the METER thought was silent be discarded and a fresh one
   * started, instead of transcribed. That was a considered design decision — don't ship silence to
   * Whisper — and it was wrong in a way only a round could show. Tim's issue log, five in one round:
   * `tap_ended_silent_capture` at durationMs 2493 / 3075 / 4326 / 4458 / 4902, alongside his note
   * "Caddie ignored me when I talked most of the round". Nobody holds the mic open for 4.9 seconds
   * in silence. He was speaking and the audio was thrown away unheard.
   *
   * Two of those fired warm and mid-round (hole 17, hole 10), which rules out cold start, network and
   * the brain. What remained was `micHasSpokenRef`, set only when Expo metering crosses a FIXED
   * -30 dBFS — on Android, outdoors, at arm's length, in wind.
   *
   * The contract is now: the meter may decide when to STOP listening; it may not decide whether words
   * were said. Whisper decides that, because Whisper is the only thing that actually knows.
   */
  it('a capture is transcribed even when the meter heard nothing — the meter is not the judge', () => {
    // The veto is gone: no branch discards the audio before Whisper sees it.
    expect(src).not.toContain("logVoiceSilentFail('tap_ended_silent_capture'");
    expect(src).toContain('await processAudioUri(uri);');
    // The disagreement is still MEASURED — when this fires and a transcript comes back with words,
    // that is the meter being wrong, and we want to know how often and on which devices.
    expect(src).toContain("logVoiceSilentFail('meter_silent_transcribing_anyway'");
    // And the restart path survives for the case it was really for: a DEAD recording.
    expect(src).toContain('restartFresh = true;');
    expect(src).toContain('if (!restartFresh) return;');
  });

  it('a tap that finds a DEAD recording still opens the mic', () => {
    // Was: null the ref, go idle — so the tap did nothing and only the SECOND tap worked.
    const katch = src.slice(src.indexOf("console.log('[voice] stop error:', err);"));
    expect(katch.slice(0, 800)).toContain('restartFresh = true;');
  });

  it('a stray double-tap is still NOT restarted', () => {
    // Sub-300ms is the tap-tap signature; reopening there would leave the mic hot after the user
    // meant to close it. This one must keep its early return.
    const start = src.indexOf('if (durationMs != null && durationMs < 300) {');
    const shortBranch = src.slice(start, src.indexOf('if (!micHasSpokenRef.current) {', start));
    expect(shortBranch).toContain('return;');
  });

  it('restart falls through rather than recursing — a broken mic cannot loop', () => {
    expect(src).toContain('// fall through to START — one fresh capture, no recursion, so a broken mic can\'t loop');
  });
});

describe('a mic the user never asked for does not stay hot', () => {
  const src = read('hooks/useVoiceCaddie.ts');

  it('stands down when it hears nothing at all', () => {
    expect(src).toContain('const NO_SPEECH_STANDDOWN_MS = 7_000;');
    expect(src).toContain('if (!micHasSpoken && Date.now() - recordStartedAt >= NO_SPEECH_STANDDOWN_MS) {');
  });

  it('stands down QUIETLY — no transcribe, no error, no announcement', () => {
    const branch = src.slice(src.indexOf('if (!micHasSpoken && Date.now() - recordStartedAt >= NO_SPEECH_STANDDOWN_MS) {'));
    const body = branch.slice(0, 700);
    expect(body).toContain('rec.stopAndUnloadAsync()');
    expect(body).toContain("wrappedOnVoiceStateChange('idle')");
    // Shipping the silence anywhere is the bug being fixed.
    expect(body).not.toContain('processAudioUri');
    expect(body).not.toContain('hardStopAndProcess');
  });

  it('stands down well before the 18s wall-clock cap that used to hold the mic', () => {
    const standdown = Number(/const NO_SPEECH_STANDDOWN_MS = ([\d_]+);/.exec(src)![1].replace(/_/g, ''));
    const cap = Number(/const MAX_RECORD_MS = ([\d_]+);/.exec(src)![1].replace(/_/g, ''));
    expect(standdown).toBeLessThan(cap);
    // Still long enough to think before answering the caddie.
    expect(standdown).toBeGreaterThanOrEqual(5000);
  });

  it('never stands down on a capture that HAS heard speech', () => {
    // The adaptive endpoint owns that case; standing down mid-sentence would clip the user.
    expect(src).toContain('if (!micHasSpoken && Date.now() - recordStartedAt >= NO_SPEECH_STANDDOWN_MS)');
  });
});
