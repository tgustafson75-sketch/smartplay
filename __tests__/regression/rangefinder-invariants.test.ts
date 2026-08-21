/**
 * SmartFinder invariant sweep — the number players trust most.
 *
 * 2026-08-21. Tim queued this: "check code next session is SmartFinder. The RANGEFINDER = the number
 * players trust." Same method that found four defects in the course engine and the swing gate: assert
 * PROPERTIES over generated inputs, not expected outputs, so the test cannot merely re-state the
 * implementation.
 *
 * It immediately found the confidence bands were unreachable AND backwards — see the note in
 * services/rangefinder.ts. The invariants below are what stops that recurring.
 */
import { computeDistance, confidenceMargin } from '../../services/rangefinder';
import { haversineYards } from '../../utils/geoDistance';

const HERE = { lat: 42.4, lng: -71.9, accuracy: 5 };
const read = (pitch: number, tapY = 0.5, tapX = 0.5, heading = 90) =>
  computeDistance({
    user_position: HERE, compass_heading: heading,
    tap_x_normalized: tapX, tap_y_normalized: tapY, device_pitch_degrees: pitch,
  });

describe('the number is always a number', () => {
  it('never produces NaN, Infinity or a negative yardage for ANY input', () => {
    const wild = [0, -1, -0.5, -90, 90, 180, -180, 1e6, -1e6, 0.0001, -45.5];
    for (const pitch of wild) {
      for (const tapY of [0, 0.25, 0.5, 0.75, 1]) {
        for (const heading of [0, 90, 359.9]) {
          const r = read(pitch, tapY, 0.5, heading);
          expect(Number.isFinite(r.distance_yards)).toBe(true);
          expect(r.distance_yards).toBeGreaterThan(0);
          expect(Number.isFinite(r.target_lat)).toBe(true);
          expect(Number.isFinite(r.target_lng)).toBe(true);
        }
      }
    }
  });

  it('stays inside the golf-realistic clamp, always', () => {
    for (let pitch = -89; pitch <= 89; pitch += 1) {
      const r = read(pitch);
      expect(r.distance_yards).toBeGreaterThanOrEqual(10);
      expect(r.distance_yards).toBeLessThanOrEqual(400);
    }
  });
});

describe('the number moves the way the world moves', () => {
  it('aiming STEEPER DOWN always reads CLOSER — never inverts', () => {
    // Monotonicity is the property a player checks unconsciously every time they move the phone.
    let prev = Infinity;
    for (let pitch = -3; pitch >= -45; pitch -= 1) {
      const d = read(pitch).distance_yards;
      expect(d).toBeLessThanOrEqual(prev);
      prev = d;
    }
  });

  it('tapping LOWER in the frame reads closer than tapping higher', () => {
    // Things at the bottom of a camera frame are nearer. If this ever inverts, moving the reticle
    // would make the yardage move the wrong way — the exact "math not adjusting" complaint.
    const high = read(-6, 0.2).distance_yards;
    const low = read(-6, 0.8).distance_yards;
    expect(low).toBeLessThanOrEqual(high);
  });
});

describe('the target it projects is the target it measured', () => {
  it('the projected point sits the reported distance away — geometry round-trips', () => {
    for (const pitch of [-6, -10, -20, -35]) {
      const r = read(pitch);
      const back = haversineYards(HERE, { lat: r.target_lat, lng: r.target_lng });
      // Distance is rounded for display; the projection must still agree within that rounding.
      expect(Math.abs(back - r.distance_yards)).toBeLessThan(2);
    }
  });

  it('reticle left of centre aims LEFT of the compass heading, and right aims right', () => {
    const heading = 90;
    const centre = read(-10, 0.5, 0.5, heading);
    const left = read(-10, 0.5, 0.1, heading);
    const right = read(-10, 0.5, 0.9, heading);
    const bearingOf = (r: { target_lat: number; target_lng: number }) => {
      const dLng = r.target_lng - HERE.lng;
      return Math.atan2(dLng, r.target_lat - HERE.lat);
    };
    expect(bearingOf(left)).toBeLessThan(bearingOf(centre));
    expect(bearingOf(right)).toBeGreaterThan(bearingOf(centre));
  });
});

describe('confidence tells the truth about the method', () => {
  it('HIGH is reachable at all — it was not', () => {
    // The bug: bands required >=50 yards AND an angle of -30..-5, which yields 3-20 yards. The two
    // could never both hold, so this method could never report high confidence to anyone.
    const anyHigh = Array.from({ length: 80 }, (_, i) => read(-(i + 1)))
      .some(r => r.confidence === 'high');
    expect(anyHigh).toBe(true);
  });

  it('confidence FALLS as the phone approaches level, because the error rises', () => {
    // d = h/tan(θ): relative error ≈ 2Δθ/sin(2θ). A half-degree of noise is 2.7% at -20° and 20% at
    // -2°. Confidence must never be highest where the method is weakest.
    const rank = { low: 0, medium: 1, high: 2 } as const;
    const steep = rank[read(-20).confidence];
    const mid = rank[read(-5).confidence];
    const shallow = rank[read(-2.5).confidence];
    expect(steep).toBeGreaterThanOrEqual(mid);
    expect(mid).toBeGreaterThanOrEqual(shallow);
  });

  it('an unmeasurable reading is never dressed up as confident', () => {
    for (const pitch of [0, -1, -1.9, 5, 45]) {
      const r = read(pitch);
      if (r.unmeasurable) expect(r.confidence).toBe('low');
    }
  });

  it('a wider margin always accompanies weaker confidence', () => {
    expect(confidenceMargin('high')).toBeLessThan(confidenceMargin('medium'));
    expect(confidenceMargin('medium')).toBeLessThan(confidenceMargin('low'));
  });
});
