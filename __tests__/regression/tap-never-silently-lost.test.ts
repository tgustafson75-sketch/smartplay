import * as fs from 'fs';
import * as path from 'path';
const ls = fs.readFileSync(path.resolve(__dirname, '../../services/listeningSession.ts'), 'utf-8');

/**
 * 2026-08-22 — Tim's field log, three times in one round:
 *   voice_silent_fail: tap_swallowed · guard: session_in_flight · sessionState: opening
 *
 * A tap during the mic-opening window was discarded outright, echo or not. Opening takes a moment on
 * a cold mic, which is exactly when a person presses again — and that press vanished with nothing on
 * screen to say why. [[hands-free-zero-setup-is-the-product]]
 */
describe('a real tap is never silently lost', () => {
  it('tells an echo from a person', () => {
    // One physical tap reaches toggle() twice ~350ms apart; that one still dies.
    expect(ls).toMatch(/const isEcho = Date\.now\(\) - sessionOpenTapAt < TAP_ECHO_SWALLOW_MS/);
    expect(ls).toMatch(/sessionOpenTapAt = Date\.now\(\)/);
  });

  it('acts on a genuine tap that lands while the mic is still opening: skip the cue, listen now', () => {
    // 2026-10-28 (Tim) — "I'm ready", not "I'm done". Driven end to end in
    // a-tap-while-the-mic-opens-ends-the-capture.test.ts; this pins the shape.
    expect(ls).toMatch(/if \(!isEcho && state === 'opening'\) \{\s*skipOpenCue = true;\s*void stopSpeaking\(/);
    expect(ls).toMatch(/tap_skipped_open_cue/);
    expect(ls).toMatch(/if \(settings\.voiceEnabled && !skipOpenCue && origin !== 'auto_reopen'\)/);
  });

  it('and a fresh session starts with it disarmed', () => {
    expect(ls).toMatch(/sessionInFlight = true;\s*\n\s*sessionOpenTapAt = Date\.now\(\);\s*\n\s*skipOpenCue = false;/);
  });
});
