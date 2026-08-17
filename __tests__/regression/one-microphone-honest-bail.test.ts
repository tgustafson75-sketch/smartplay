/**
 * 2026-08-17 — ONE MICROPHONE, and a caddie that says the true thing about it.
 *
 * Tim: "the Caddie mic acts just like an earbud tap. It goes 'I'm here.' And then right away almost
 * goes 'I didn't catch that.'" It literally was the earbud tap — the bottom-bar mic calls the same
 * listeningSession.toggle() the earbud subscribes to — while the Caddie-tab avatar ran a SECOND,
 * unrelated recorder (useVoiceCaddie). Two microphone owners, no arbiter. The tab hands itself the
 * mic after proactive speech; a tap then spoke the go-ahead cue, found the mic already held, and
 * announced the resulting empty capture as the user's failure to speak.
 *
 * This pins the part that can be tested as pure logic: what the caddie is ALLOWED to say about an
 * empty capture, and when a failed mic is worth retrying. The wiring/order (claim the mic before
 * promising to listen, one meaning for the second tap) is pinned by the LOCK guards in
 * scripts/simulations/run-sim.ts, which assert ORDER rather than string presence.
 */
import {
  responseForCaptureBail,
  shouldRetryCapture,
  type CaptureBail,
} from '../../services/voice/captureBail';
import { CADDIE_NOTICE_DIDNT_CATCH, CADDIE_NOTICE_MIC_TROUBLE } from '../../services/caddieAckLines';

const ALL_BAILS: CaptureBail[] = [
  'mic_busy', 'no_permission', 'cancelled', 'no_uri',
  'too_short', 'too_small', 'too_large', 'transcribe_failed', 'error', 'empty',
];

describe('an empty capture must not be blamed on the player', () => {
  it('never says "didn\'t catch that" when the microphone never produced audio', () => {
    // THE BUG, as one assertion. A busy mic recorded nothing, so there was nothing to catch —
    // telling the player to repeat themselves cannot work and hides a real defect behind their voice.
    for (const bail of ['mic_busy', 'error', 'no_uri'] as const) {
      expect(responseForCaptureBail(bail)).toBe('mic_trouble');
    }
  });

  it('names a transcribe failure as a connection problem, not a listening problem', () => {
    expect(responseForCaptureBail('transcribe_failed')).toBe('connection');
  });

  it('stays quiet when the user cancelled, or the OS is handling permission', () => {
    expect(responseForCaptureBail('cancelled')).toBe('silent');
    expect(responseForCaptureBail('no_permission')).toBe('silent');
  });

  it('keeps "didn\'t catch that" for the case where it is actually true', () => {
    // The mic was open and produced audio; there were just no usable words in it.
    for (const bail of ['empty', 'too_short', 'too_small', 'too_large'] as const) {
      expect(responseForCaptureBail(bail)).toBe('didnt_catch');
    }
  });

  it('maps every bail to exactly one response — no reason falls through unhandled', () => {
    const allowed = ['silent', 'mic_trouble', 'connection', 'didnt_catch'];
    for (const bail of ALL_BAILS) expect(allowed).toContain(responseForCaptureBail(bail));
    // A successful capture asks nothing of this function, but must not throw if it is consulted.
    expect(allowed).toContain(responseForCaptureBail(null));
  });
});

describe('retry only when the microphone itself failed', () => {
  it('retries a mic that never opened or died mid-capture', () => {
    expect(shouldRetryCapture('mic_busy')).toBe(true);
    expect(shouldRetryCapture('error')).toBe(true);
  });

  it('never retries a capture that simply heard nothing', () => {
    // Re-opening the mic on someone who didn't speak is the hot-mic behavior the 2026-08-12
    // standdown fix removed; the retry must not quietly bring it back.
    for (const bail of ['empty', 'too_short', 'too_small', 'cancelled', 'no_permission'] as const) {
      expect(shouldRetryCapture(bail)).toBe(false);
    }
    expect(shouldRetryCapture(null)).toBe(false);
  });

  it('does not retry a transcribe failure — the mic worked, the network did not', () => {
    expect(shouldRetryCapture('transcribe_failed')).toBe(false);
  });
});

describe('the honest lines exist and are distinct', () => {
  it('has a mic-failure line that owns the failure instead of deflecting it', () => {
    for (const lang of ['en', 'es', 'zh'] as const) {
      expect(CADDIE_NOTICE_MIC_TROUBLE[lang].trim().length).toBeGreaterThan(0);
      expect(CADDIE_NOTICE_MIC_TROUBLE[lang]).not.toBe(CADDIE_NOTICE_DIDNT_CATCH);
    }
  });
});
