/**
 * 2026-09-10 — shotDetectionService's two teardown paths disagreed, and the round-end one leaked
 * the state that matters most.
 *
 * pause() (the mid-round Auto Shot Detection toggle) cleared lastShotEmitTime. stop() (round end)
 * did not, and also left the transport-sensing state behind. Both are per-ROUND facts:
 *
 *  - lastShotEmitTime feeds a 30-second emit cooldown, so a round begun within 30s of the previous
 *    round's last shot had its first shot silently swallowed.
 *
 *  - cartEvidence / lastSensedCart is the worse one. End a cart round with lastSensedCart = true.
 *    On the next round app/_layout calls configure({ cartMode: settings.cartMode }), resetting the
 *    thresholds to the WALKING profile. senseTransport then sees speed > 4, finds cartEvidence
 *    already at its ceiling, computes sensed === lastSensedCart, and returns early — never
 *    re-applying the cart tuning it believes is already on. Every round after the first cart round
 *    ran the wrong detection profile for its entire length.
 *
 * pause() deliberately does NOT reset these — a mid-round toggle leaves the player on the same
 * course in the same transport, and re-learning it from scratch would be worse. That asymmetry is
 * asserted here so it is a decision rather than an oversight.
 */
import fs from 'fs';
import path from 'path';

const src = fs.readFileSync(
  path.join(__dirname, '../../services/shotDetectionService.ts'), 'utf8',
);

/** Body of a method, cut at the next method declaration rather than a byte guess. */
function methodBody(name: string): string {
  const at = src.indexOf(`\n  ${name}(`);
  if (at < 0) return '';
  const rest = src.slice(at + 1);
  const next = rest.search(/\n\n  (?:\/\*\*|[a-zA-Z_])/);
  return next > 0 ? rest.slice(0, next) : rest.slice(0, 2000);
}

describe('round two must not inherit round one', () => {
  it('the method-body windows actually matched something', () => {
    // A window that missed would make every assertion below vacuously pass.
    expect(methodBody('stop').length).toBeGreaterThan(200);
    expect(methodBody('pause').length).toBeGreaterThan(100);
  });

  it('stop() clears the emit cooldown, like pause() already did', () => {
    expect(methodBody('stop')).toMatch(/this\.lastShotEmitTime = 0/);
  });

  it('stop() clears the transport sensing, so a cart round cannot poison the next one', () => {
    const body = methodBody('stop');
    expect(body).toMatch(/this\.cartEvidence = 0/);
    expect(body).toMatch(/this\.lastSensedCart = null/);
  });

  it('pause() does NOT clear the transport sensing — that asymmetry is deliberate', () => {
    const body = methodBody('pause');
    expect(body).not.toMatch(/this\.cartEvidence = 0/);
    expect(body).not.toMatch(/this\.lastSensedCart = null/);
  });

  it('the early return that made it stick is still the one being guarded', () => {
    // If senseTransport stops short-circuiting on an unchanged verdict, this fix is about a
    // mechanism that moved and should be re-read rather than trusted.
    expect(src).toMatch(/if \(sensed == null \|\| sensed === this\.lastSensedCart\) return;/);
  });

  it('the emit cooldown it protects is still 30s', () => {
    expect(src).toMatch(/EMIT_COOLDOWN_MS = 30_000/);
  });
});
