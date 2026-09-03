/**
 * 2026-09-03 — SwingSim reported every putt at about half its true length.
 *
 * The yards→feet conversion had THREE owners. Both harnesses were right (`remaining * 3`, and
 * `/ YDS_PER_FT` where YDS_PER_FT = 1/3). The SHIPPED on-device screen used `* 1.6`, so a
 * thirty-foot putt came up as sixteen — which reads as makeable, and the engine then holed it far
 * more often than it should have.
 *
 * The screen also added `Math.abs(out.lateralYds)` — a YARDS value — onto that FEET value. That was
 * a stand-in from when the remaining distance ignored lateral entirely; once restingDistanceYds
 * began folding lateral into the hypotenuse earlier the same day, the line started double-counting
 * it. A correct fix upstream turned an approximation into a compounding error, which is precisely
 * why this now has one owner.
 */
import { puttFeetFrom, FEET_PER_YARD } from '../../services/simGame';

describe('puttFeetFrom', () => {
  it('knows a yard is three feet', () => {
    expect(FEET_PER_YARD).toBe(3);
    expect(puttFeetFrom(10)).toBe(30);
    // The old screen produced 16 here. That is the whole bug.
    expect(puttFeetFrom(10)).not.toBe(16);
    expect(puttFeetFrom(1)).toBe(3);
  });

  it('floors at a tap-in rather than zero', () => {
    expect(puttFeetFrom(0)).toBe(1);
    expect(puttFeetFrom(0.1)).toBe(1);
  });

  it('never returns NaN for junk', () => {
    expect(puttFeetFrom(NaN)).toBe(1);
    expect(puttFeetFrom(-5)).toBe(1);
    expect(puttFeetFrom(Infinity)).toBe(1);
  });

  it('is monotonic — a longer putt is never reported shorter', () => {
    let prev = 0;
    for (const y of [0, 1, 2, 5, 10, 18, 30]) {
      const ft = puttFeetFrom(y);
      expect(ft).toBeGreaterThanOrEqual(prev);
      prev = ft;
    }
  });
});
