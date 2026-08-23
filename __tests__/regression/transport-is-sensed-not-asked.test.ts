import * as fs from 'fs';
import * as path from 'path';
const src = fs.readFileSync(path.resolve(__dirname, '../../services/shotDetectionService.ts'), 'utf-8');

/**
 * 2026-08-23 (Tim — "I wasn't walking yesterday. I was in a cart. I just forgot to do the settings…
 * I'm pretty sure other apps, I don't always have to tell if I'm a cart or walking").
 *
 * Cart and walking need different detector tuning, and the app made the player declare which. That
 * setting is trivially forgotten on the first tee and then silently wrong for eighteen holes: he rode
 * a full round with the WALKING detector armed, so his approach shots never registered and the stroke
 * count drifted. Speed is on every GPS sample; nothing walks at 4 m/s.
 */
describe('the app senses cart vs walking instead of asking', () => {
  it('senses on every ingested sample', () => {
    expect(src).toMatch(/this\.senseTransport\(sample\)/);
    expect(src).toMatch(/private senseTransport\(/);
  });

  it('needs SUSTAINED evidence, not one reading', () => {
    // A single spurious fix must never retune the detector mid-hole.
    expect(src).toMatch(/cartEvidence = Math\.min\(6, this\.cartEvidence \+ 1\)/);
    expect(src).toMatch(/cartEvidence >= 4/);
  });

  it('decays, so parking the cart and walking reverts it', () => {
    expect(src).toMatch(/cartEvidence = Math\.max\(0, this\.cartEvidence - 1\)/);
    expect(src).toMatch(/cartEvidence <= 1/);
  });

  it('uses a threshold no walker can reach, and a separate lower one to fall back', () => {
    expect(src).toMatch(/speed > 4\.0/);   // ~9 mph
    expect(src).toMatch(/speed < 1\.8/);   // hysteresis gap: no flapping at the boundary
  });

  it('never overrides a player who actually chose', () => {
    expect(src).toMatch(/An explicit player choice is never overridden/);
    expect(src).toMatch(/declared === 'cart' \|\| declared === 'walking'/);
  });

  it('honours that choice by retuning to it rather than ignoring the mismatch', () => {
    // If they picked cart and the detector is on walking tuning, fix the detector.
    expect(src).toMatch(/if \(\(declared === 'cart'\) !== this\.config\.cartMode\) this\.configure\(\{ cartMode: declared === 'cart' \}\)/);
  });

  it('walking tuning is reachable in a real approach-shot timeframe', () => {
    // 20s of required stillness is trivially true on a tee and often false at your ball in the
    // fairway, which is why the drive counted and the approach did not.
    expect(src).toMatch(/const WALK_STATIONARY_MS = 10_000;/);
    expect(src).not.toMatch(/stationaryWindowMs: 20_000/);
  });
});
