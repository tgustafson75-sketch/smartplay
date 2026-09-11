/**
 * 2026-09-10 — 'stationary' WAS UNREACHABLE EXACTLY WHEN THE PLAYER WAS STATIONARY.
 *
 * movementModeDetector's speed buffer is fed only by subscribeGps and evicted at 30s, so its
 * occupancy is `30_000 / POLL_CONFIG[mode].intervalMs`:
 *     active      1s → 30 samples
 *     walking    10s →  3 samples  — needing 3 meant unanimity; one noisy fix → 'unknown'
 *     stationary 20s →  2 samples  — no branch could EVER reach SUSTAIN_NEEDED = 3
 *
 * And gpsManager only enters stationary mode after 90s of no motion — so the detector was
 * structurally unable to report 'stationary' precisely when it was true. The cart/walking indicator
 * blanked to unknown whenever the player stood still, and avg_speed_mps reset to -1.
 *
 * The file's own header names "iOS never classifies stationary" as the bug it was written to fix;
 * the 30s eviction window re-created it on the two cadences a round actually uses.
 */
import fs from 'fs';
import path from 'path';

const src = fs.readFileSync(
  path.join(__dirname, '../../services/movementModeDetector.ts'), 'utf8',
);

/** The shipped rule, mirrored here so the table below is checked against the real expression. */
const SUSTAIN_NEEDED = 3;
const neededFor = (len: number) => Math.min(SUSTAIN_NEEDED, Math.max(2, len - 1));

describe('the sustain requirement fits the buffer', () => {
  it('the source uses the scaled value, not the bare constant', () => {
    expect(src).toMatch(/const needed = Math\.min\(SUSTAIN_NEEDED, Math\.max\(2, speedBuffer\.length - 1\)\)/);
  });

  it('applies it to ALL THREE branches — a half-fix here would be worse than none', () => {
    expect(src).toMatch(/if \(cartCount >= needed\) next = 'cart';/);
    expect(src).toMatch(/else if \(walkCount >= needed\) next = 'walking';/);
    expect(src).toMatch(/else if \(stillCount >= needed\) next = 'stationary';/);
    // and the bare constant must no longer gate a branch
    expect(src).not.toMatch(/Count >= SUSTAIN_NEEDED/);
  });

  it('is unchanged in active mode, where the buffer holds plenty', () => {
    // 1s cadence → ~30 samples. This must stay exactly 3 of N.
    expect(neededFor(30)).toBe(3);
    expect(neededFor(10)).toBe(3);
    expect(neededFor(5)).toBe(3);
    expect(neededFor(4)).toBe(3);
  });

  it('is reachable at the walking cadence (3 samples)', () => {
    expect(neededFor(3)).toBe(2);
    expect(neededFor(3)).toBeLessThanOrEqual(3);
  });

  it('is reachable at the stationary cadence (2 samples) — the whole point', () => {
    expect(neededFor(2)).toBe(2);
    expect(neededFor(2)).toBeLessThanOrEqual(2);
  });

  it('never drops below 2, so one noisy sample cannot flip the mode', () => {
    for (let n = 1; n <= 40; n++) expect(neededFor(n)).toBeGreaterThanOrEqual(2);
    // with a single sample, no count can reach 2 — the mode holds rather than flipping
    expect(neededFor(1)).toBe(2);
  });

  it('leaves the 30s eviction alone — a parked cart still cannot hold its classification', () => {
    // That window is the 2026-08-08 fix; widening it instead would have re-broken that.
    expect(src).toMatch(/Date\.now\(\) - 30_000/);
    expect(src).toMatch(/SUSTAIN_NEEDED = 3/);
  });
});
