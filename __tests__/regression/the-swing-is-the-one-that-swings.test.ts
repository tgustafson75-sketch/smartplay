/**
 * 2026-10-16 (adversarial review of S1a) — deriveSwingAnchors' height read took the FIRST rise past 60%
 * of the hands' height as the top and the lowest point after it, however late, as impact. On Tim's real
 * 3870 wrists (strike HEARD at 7.00s) one raised-hands sample at 3.0s — a waggle, aiming, a practice
 * swing — made impact 5.5s; a slower practice swing at 90% height made it 3.6s. Downstream that moves
 * the on-device locate's swing time, the stored 'strike' label, and the club arc's anchor onto address.
 *
 * And the finish stopped at the first dip after the climb: 3870's finish landed 100ms after impact (the
 * hands are highest ~7.24-7.54s), Lily's 4075 at 6.33s against a held finish at ~6.55s.
 */
import tim from '../fixtures/locate-3870-wrists.json';
import lily from '../fixtures/lily-4075-wrists.json';
import { deriveSwingAnchors, type MotionSample } from '../../services/swing/poseMotion';

const real: MotionSample[] = (tim.samples as number[][]).map(([tMs, x, y]) => ({ tMs, x, y })).sort((a, b) => a.tMs - b.tMs);
const STRIKE = 7000;
const BASE_Y = 0.6123;

describe('a raised-hands moment before the swing is not the swing', () => {
  it('the real clip, untouched', () => {
    const a = deriveSwingAnchors(real)!;
    expect(Math.abs(a.impactMs - STRIKE)).toBeLessThanOrEqual(120);
  });

  it('one stray high sample at 3.0s (waggle / aiming)', () => {
    const s = real.map((p) => (p.tMs === 3005 ? { ...p, y: BASE_Y - 0.09 } : p));
    const a = deriveSwingAnchors(s)!;
    expect(Math.abs(a.impactMs - STRIKE)).toBeLessThanOrEqual(120);
  });

  it('a slower practice swing at 90% height before the real one', () => {
    const seg = real.filter((p) => p.tMs >= 5429 && p.tMs <= 7854);
    const practice = seg.map((p) => ({ tMs: 1200 + (p.tMs - 5429) * 1.6, x: p.x, y: BASE_Y - (BASE_Y - p.y) * 0.9 }));
    const s = [...real.filter((p) => p.tMs < 1200 || p.tMs >= 5429), ...practice].sort((a, b) => a.tMs - b.tMs);
    const a = deriveSwingAnchors(s)!;
    expect(Math.abs(a.impactMs - STRIKE)).toBeLessThanOrEqual(120);
  });

  it('a coarse practice top and finish at 1.8s / 3.0s', () => {
    const s = real.map((p) => (p.tMs === 1792 ? { ...p, y: BASE_Y - 0.09 } : p.tMs === 3005 ? { ...p, y: BASE_Y - 0.095 } : p));
    const a = deriveSwingAnchors(s)!;
    expect(Math.abs(a.impactMs - STRIKE)).toBeLessThanOrEqual(120);
  });
});

describe('the finish is the held finish, not the first dip after impact', () => {
  it("Tim's 3870: hands highest ~7.24-7.54s", () => {
    const a = deriveSwingAnchors(real)!;
    expect(a.endMs).toBeGreaterThanOrEqual(7240);
    expect(a.endMs).toBeLessThanOrEqual(7600);
  });

  it("Lily's 4075 (30fps track): held finish ~6.55s", () => {
    const s = (lily.samples as number[][]).map(([tMs, x, y]) => ({ tMs, x, y })).filter((p) => p.tMs >= 4300 && p.tMs <= 7600);
    const a = deriveSwingAnchors(s)!;
    expect(Math.abs(a.endMs - 6550)).toBeLessThanOrEqual(150);
    expect(Math.abs(a.impactMs - 6040)).toBeLessThanOrEqual(120);
  });
});
