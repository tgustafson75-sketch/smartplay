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

  it('queues a genuine tap that lands while the mic is still opening', () => {
    expect(ls).toMatch(/if \(!isEcho && state === 'opening'\)/);
    expect(ls).toMatch(/pendingEndpointTap = true/);
    expect(ls).toMatch(/queued_during_opening/);
  });

  it('honours it the moment the mic is live', () => {
    const armed = ls.indexOf('listeningStartedAt = Date.now()');
    const applied = ls.indexOf('if (pendingEndpointTap)');
    expect(armed).toBeGreaterThan(-1);
    expect(applied).toBeGreaterThan(armed);
    expect(ls).toMatch(/pendingEndpointTap = false;\s*\n\s*console\.log\('\[audit:voice\] applying tap queued/);
  });

  it('clears the flag before acting so a failure cannot arm the next session', () => {
    const block = ls.slice(ls.indexOf('if (pendingEndpointTap)'));
    const clear = block.indexOf('pendingEndpointTap = false');
    const act = block.indexOf('endCaptureEarly()');
    expect(clear).toBeLessThan(act);
  });

  it('and a fresh session starts with it disarmed', () => {
    expect(ls).toMatch(/sessionInFlight = true;\s*\n\s*sessionOpenTapAt = Date\.now\(\);\s*\n\s*pendingEndpointTap = false;/);
  });
});
