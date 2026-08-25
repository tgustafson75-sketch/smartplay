/**
 * 2026-08-24 (Tim, third report of the same thing) — "the moving around of the aperture to get
 * yardage still isn't very reactive in terms of accuracy."
 *
 * The tilt rangefinder physically cannot answer this: at ~1.6 m phone height a 150-yard target sits
 * at 0.67 degrees of down-angle, under the 2-degree floor where a read is `unmeasurable` by design.
 * services/rangefinder has said since 07-22 that it "physically caps at ~50 yds". Two earlier passes
 * widened a plausibility gate; a gate cannot fix a method with no resolution.
 *
 * So the reticle answers from the MAP instead: which known thing lies along this bearing, and how
 * far is it. GPS-accurate, no scan round-trip, and it moves the instant the reticle does.
 */
import { featureOnAimLine, DEFAULT_TOLERANCE_YARDS, type AimCandidate } from '../../services/aimedFeature';
import { destinationPoint } from '../../utils/geoDistance';

const TEE = { lat: 42.4100, lng: -71.6300 };
/** A candidate `yards` away on `bearing` from the tee. */
const at = (label: string, bearing: number, yards: number, toleranceYards?: number): AimCandidate => ({
  label, location: destinationPoint(TEE, bearing, yards), ...(toleranceYards ? { toleranceYards } : {}),
});

describe('the reticle names what you are aiming at', () => {
  const green = at('green', 0, 205);
  const bunkerRight = at('right bunker', 12, 150);
  const waterLeft = at('water left', -20, 120);
  const all = [green, bunkerRight, waterLeft];

  it('aiming straight down the hole finds the green, at its real GPS distance', () => {
    const f = featureOnAimLine(TEE, 0, all);
    expect(f?.label).toBe('green');
    expect(f?.yards).toBeGreaterThan(200);
    expect(f?.yards).toBeLessThan(210);
  });

  it('swinging the reticle right picks up the bunker — this is the "reactive" part', () => {
    expect(featureOnAimLine(TEE, 12, all)?.label).toBe('right bunker');
  });

  it('swinging left picks up the water', () => {
    expect(featureOnAimLine(TEE, -20, all)?.label).toBe('water left');
  });

  it('aiming at nothing we know returns NULL rather than inventing a target', () => {
    // 90 degrees off the hole — there is nothing mapped there, and saying so is the honest answer.
    expect(featureOnAimLine(TEE, 90, all)).toBeNull();
  });

  it('never claims something BEHIND the player', () => {
    expect(featureOnAimLine(TEE, 180, all)).toBeNull();
  });

  it('picks the most precisely aimed-at feature, not merely the nearest', () => {
    // A bunker 150y out at 12 degrees vs the green 205y dead ahead. Aimed dead ahead, the answer is
    // the green — nearest-wins would let a near hazard permanently shadow the target behind it.
    expect(featureOnAimLine(TEE, 0, [bunkerRight, green])?.label).toBe('green');
  });

  it('a tighter tolerance makes a small target harder to claim', () => {
    const pot = at('pot bunker', 6, 150, 5);
    // ~15 yards of lateral offset at 150y — inside the default, outside a 5-yard pot-bunker tolerance.
    expect(featureOnAimLine(TEE, 0, [pot])).toBeNull();
    expect(featureOnAimLine(TEE, 0, [at('green', 6, 150)])?.label).toBe('green');
  });

  it('reports how far OFF the line it is, so a grazing hit can be shown as soft', () => {
    const f = featureOnAimLine(TEE, 3, [green]);
    expect(f).not.toBeNull();
    expect(f!.offsetYards).toBeGreaterThan(0);
    expect(f!.offsetYards).toBeLessThanOrEqual(DEFAULT_TOLERANCE_YARDS);
  });

  it('survives junk without throwing — no fix, no coords, no candidates', () => {
    expect(featureOnAimLine(null, 0, all)).toBeNull();
    expect(featureOnAimLine(TEE, NaN, all)).toBeNull();
    expect(featureOnAimLine(TEE, 0, [])).toBeNull();
    expect(featureOnAimLine(TEE, 0, [{ label: 'bad', location: { lat: NaN, lng: 0 } }])).toBeNull();
  });

  it('handles the 0/360 wrap — aiming north is not 360 degrees away from north', () => {
    const north = at('green', 359, 205);
    expect(featureOnAimLine(TEE, 1, [north])?.label).toBe('green');
  });
});
