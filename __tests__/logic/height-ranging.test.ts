/**
 * SmartFinder known-height ranging — the GPS-free, any-distance rangefinder that makes
 * SmartFinder usable anywhere (yard, cage, range). distance = H / (2·tan(θ/2)), where θ is
 * the target's angular height from the tapped top/base span. Expected distances below are
 * hand-computed for a 7 ft flagstick (2.134 m) at VFOV 60°.
 */
import { computeHeightRangedDistance, REFERENCE_HEIGHTS } from '../../services/rangefinder';

const FLAG = 2.134; // 7 ft flagstick, metres

describe('computeHeightRangedDistance', () => {
  it('measures a far target (~2% of frame) at ~100 yds', () => {
    const r = computeHeightRangedDistance({
      top_y_normalized: 0.49, base_y_normalized: 0.51, real_height_m: FLAG, vfov_deg: 60,
    });
    expect(r.unmeasurable).toBe(false);
    expect(r.distance_yards).toBeGreaterThanOrEqual(98);
    expect(r.distance_yards).toBeLessThanOrEqual(104);
    expect(r.confidence).toBe('medium'); // ~1.3° angular height
  });

  it('measures a mid target (~10% of frame) at ~20 yds with high confidence', () => {
    const r = computeHeightRangedDistance({
      top_y_normalized: 0.45, base_y_normalized: 0.55, real_height_m: FLAG, vfov_deg: 60,
    });
    expect(r.distance_yards).toBeGreaterThanOrEqual(18);
    expect(r.distance_yards).toBeLessThanOrEqual(23);
    expect(r.confidence).toBe('high'); // ~6.6° angular height
  });

  it('gives a larger distance for a smaller frame span (monotonic)', () => {
    const near = computeHeightRangedDistance({ top_y_normalized: 0.4, base_y_normalized: 0.6, real_height_m: FLAG });
    const far = computeHeightRangedDistance({ top_y_normalized: 0.48, base_y_normalized: 0.52, real_height_m: FLAG });
    expect(far.distance_yards).toBeGreaterThan(near.distance_yards);
  });

  it('scales with zoom: the same tap span at half the VFOV reads ~2× the distance', () => {
    // Narrower FOV = the same pixel span is a smaller real angle = a farther target. This is
    // why zooming in lets you range farther targets: it enlarges their frame span for the tap.
    const wide = computeHeightRangedDistance({ top_y_normalized: 0.48, base_y_normalized: 0.52, real_height_m: FLAG, vfov_deg: 60 });
    const zoomed = computeHeightRangedDistance({ top_y_normalized: 0.48, base_y_normalized: 0.52, real_height_m: FLAG, vfov_deg: 30 });
    const ratio = zoomed.distance_yards / wide.distance_yards;
    expect(ratio).toBeGreaterThan(1.8);
    expect(ratio).toBeLessThan(2.3);
  });

  it('flags unmeasurable when the two taps coincide', () => {
    const r = computeHeightRangedDistance({ top_y_normalized: 0.5, base_y_normalized: 0.5, real_height_m: FLAG });
    expect(r.unmeasurable).toBe(true);
  });

  it('flags unmeasurable for a non-positive height', () => {
    const r = computeHeightRangedDistance({ top_y_normalized: 0.4, base_y_normalized: 0.6, real_height_m: 0 });
    expect(r.unmeasurable).toBe(true);
  });

  it('ships sensible reference heights', () => {
    const flag = REFERENCE_HEIGHTS.find((h) => h.id === 'flagstick');
    expect(flag?.meters).toBeCloseTo(2.134, 2);
    expect(REFERENCE_HEIGHTS.length).toBeGreaterThanOrEqual(4);
  });
});
