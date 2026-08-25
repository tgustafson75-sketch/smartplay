/**
 * 2026-08-24 (Tim, after a round — "the moving around of the aperture to get yardage still isn't
 * very reactive in terms of accuracy").
 *
 * SmartFinder's tilt ranging is `distance = eyeHeight / tan(pitch)`, and eyeHeight was the constant
 * 1.6 m for every player. Distance scales LINEARLY with it, so the assumption is a straight
 * multiplier on every read — hold the phone 10% lower and every number is ~10% long, which at 150
 * yards is fifteen. Two earlier passes at this same complaint widened a plausibility gate; a gate
 * cannot fix a scale error.
 *
 * The app never needs to ask for the player's height: on any GPS-anchored read it already knows the
 * distance, so h = d * tan(angle) solves for how they actually hold the phone.
 */
import {
  impliedHeightM, observeCalibration, learnedEyeHeightM, effectiveEyeHeightM,
  _resetRangefinderCalibration, DEFAULT_EYE_HEIGHT_M, MIN_SAMPLES,
} from '../../services/rangefinderCalibration';
import { computeDistance } from '../../services/rangefinder';

beforeEach(() => _resetRangefinderCalibration());

/** Distance in metres that a phone at `h` would read at `deg` of downward tilt. */
const distFor = (h: number, deg: number) => h / Math.tan((Math.abs(deg) * Math.PI) / 180);

describe('the rangefinder learns how you hold the phone', () => {
  it('solves the height that reconciles a known distance with the measured angle', () => {
    // A phone at 1.45 m looking down 1.2 degrees.
    const d = distFor(1.45, -1.2);
    expect(impliedHeightM(d, -1.2)).toBeCloseTo(1.45, 2);
  });

  it('DISCARDS an implausible sample rather than clamping it', () => {
    // Aiming at something far beyond the reference gives an absurd height. Clamping would fold the
    // mistake into the average; discarding keeps the estimate honest.
    expect(impliedHeightM(distFor(4.0, -1.2), -1.2)).toBeNull();
    expect(impliedHeightM(distFor(0.3, -1.2), -1.2)).toBeNull();
  });

  it('refuses an upward or level tilt — the geometry needs a downward angle', () => {
    expect(impliedHeightM(100, 0)).toBeNull();
    expect(impliedHeightM(100, 3)).toBeNull();
  });

  it('knows nothing until enough samples agree, and uses the old constant until then', () => {
    for (let i = 0; i < MIN_SAMPLES - 1; i++) observeCalibration(distFor(1.45, -1.2), -1.2);
    expect(learnedEyeHeightM()).toBeNull();
    expect(effectiveEyeHeightM()).toBe(DEFAULT_EYE_HEIGHT_M);   // a new player is unchanged
  });

  it('learns the height once it has enough, and it is the MEDIAN', () => {
    for (let i = 0; i < MIN_SAMPLES; i++) observeCalibration(distFor(1.45, -1.2), -1.2);
    expect(learnedEyeHeightM()).toBeCloseTo(1.45, 2);
  });

  it('one bad sample cannot drag the estimate — median, not mean', () => {
    for (let i = 0; i < MIN_SAMPLES; i++) observeCalibration(distFor(1.45, -1.2), -1.2);
    observeCalibration(distFor(1.85, -1.2), -1.2);   // a plausible but wrong outlier
    expect(learnedEyeHeightM()).toBeCloseTo(1.45, 1);
  });

  it('and the learned height actually changes the yardage — the whole point', () => {
    const input = {
      user_position: { lat: 42.41, lng: -71.63, accuracy: 5 },
      compass_heading: 0, tap_x_normalized: 0.5, tap_y_normalized: 0.5,
      // -3 degrees, inside the band the tilt method can actually resolve (past ~-2 it is
      // `unmeasurable` by design — see the note in services/rangefinder about the ~50yd cap).
      device_pitch_degrees: -3,
    };
    const stock = computeDistance(input).distance_yards;
    const shorter = computeDistance({ ...input, eye_height_m: 1.45 }).distance_yards;
    expect(stock).toBeGreaterThan(0);
    // A lower phone means the same tilt reaches a NEARER point.
    expect(shorter).toBeLessThan(stock);
    // ...and by roughly the height ratio, because distance scales linearly with it.
    expect(shorter / stock).toBeCloseTo(1.45 / DEFAULT_EYE_HEIGHT_M, 1);
  });

  it('an omitted height is byte-identical to the old constant', () => {
    const input = {
      user_position: { lat: 42.41, lng: -71.63, accuracy: 5 },
      compass_heading: 0, tap_y_normalized: 0.5, device_pitch_degrees: -3,
    };
    expect(computeDistance(input).distance_yards)
      .toBe(computeDistance({ ...input, eye_height_m: DEFAULT_EYE_HEIGHT_M }).distance_yards);
  });

  it('reports the EFFECTIVE angle it used, so calibration cannot re-derive the tap offset wrongly', () => {
    const out = computeDistance({
      user_position: { lat: 42.41, lng: -71.63, accuracy: 5 },
      compass_heading: 0, tap_y_normalized: 0.75, device_pitch_degrees: -3,
    });
    // tap below centre tilts the aim further DOWN than the device pitch alone.
    expect(out.angle_degrees).toBeLessThan(-3);
  });
});
