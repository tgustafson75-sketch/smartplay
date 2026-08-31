/**
 * 2026-08-31 (Tim chose "ray-intersect hole geometry" for the SmartFinder tilt cap).
 *
 * THE RAY MATH WAS NEVER THE GAP, and finding that out is the point of this file.
 * `featureOnAimLine` has cast the aim ray and measured lateral offset correctly since 2026-08-24.
 * What limited it was its INPUT: the candidate list was built inline in app/smartfinder.tsx and held
 * the green, its front, its back, and the coarse `hazards` array — nothing else.
 *
 * So `geometry.bunkers` and `geometry.water_hazards`, already traced as polygons and already drawn
 * by the map overlay, were invisible to the reticle. Point it at the bunker you are trying to carry
 * and the screen said nothing was there. That reads exactly like a broken rangefinder, which is what
 * was reported three times.
 *
 * The tilt cap itself is physics (150y subtends 0.67°, under the 2° floor) and is not fixable —
 * these tests are the answer that replaces it. [[smartfinder-tilt-caps-at-50-yards]]
 */
import { buildAimCandidates } from '../../services/aimCandidates';
import { featureOnAimLine } from '../../services/aimedFeature';
import type { HoleGeometry } from '../../services/courseGeometryService';

const TEE = { lat: 40.0, lng: -75.0 };
const M_PER_DEG_LAT = 111_320;
const at = (northM: number, eastM: number = 0) => ({
  lat: TEE.lat + northM / M_PER_DEG_LAT,
  lng: TEE.lng + eastM / (M_PER_DEG_LAT * Math.cos((TEE.lat * Math.PI) / 180)),
});

const hole = (over: Partial<HoleGeometry>): HoleGeometry => ({
  hole_number: 1, par: 4, yardage: 400, tee: TEE, green: null,
  green_front: null, green_back: null, bearing_deg: null,
  hazards: [], fairway_centerline: [], green_outline: [], ...over,
});
const feature = (loc: { lat: number; lng: number }, side: string | null = null) =>
  ({ polygon: [], centroid: loc, side } as never);

describe('the reticle can finally see what it is pointed at', () => {
  it('THE DEFECT: a traced bunker was never offered to the aim line', () => {
    const g = hole({ green: at(180), bunkers: [feature(at(120), 'left')] });
    const labels = buildAimCandidates(g).map((c) => c.label);
    expect(labels).toContain('left bunker');
    // ...and end-to-end: aiming at it now reports it, at a distance tilt could never measure.
    const aimed = featureOnAimLine(TEE, 0, buildAimCandidates(g));
    expect(aimed).not.toBeNull();
    expect(aimed!.label).toBe('left bunker');
    expect(aimed!.yards).toBeGreaterThan(125); // ~131yd — far past the ~50yd tilt cap
  });

  it('water is offered too, with the side it is on', () => {
    const g = hole({ water_hazards: [feature(at(140), 'right')] });
    expect(buildAimCandidates(g).map((c) => c.label)).toContain('water right');
  });

  it('reads the green at 150 yards — the distance the tilt method physically cannot reach', () => {
    const g = hole({ green: at(137) }); // 137m ≈ 150yd
    const aimed = featureOnAimLine(TEE, 0, buildAimCandidates(g));
    expect(aimed!.label).toBe('green');
    expect(aimed!.yards).toBeGreaterThan(147);
    expect(aimed!.yards).toBeLessThan(153);
  });

  it('prefers the TRACED green outline over a coarser centre point', () => {
    const g = hole({
      green: at(200),
      green_polygon: [at(140), at(140, 8), at(146), at(146, -8)],
    });
    const green = buildAimCandidates(g).find((c) => c.label === 'green')!;
    expect(green.location.lat).toBeLessThan(at(160).lat); // came from the outline, not the 200m point
  });

  it('does NOT offer the same thing twice when a hole lists a hazard in both places', () => {
    const shared = at(120);
    const g = hole({ bunkers: [feature(shared, 'left')], hazards: [{ label: 'bunker', location: shared }] });
    expect(buildAimCandidates(g)).toHaveLength(1);
  });

  it('returns an EMPTY list with no geometry — the honest chain that renders "nothing mapped there"', () => {
    expect(buildAimCandidates(null)).toEqual([]);
    expect(buildAimCandidates(hole({}))).toEqual([]);
    // ...and an empty list makes the aim line answer null rather than invent a target.
    expect(featureOnAimLine(TEE, 0, buildAimCandidates(null))).toBeNull();
  });

  it('ignores 0,0 coordinates — missing data, not a place in the Atlantic', () => {
    const g = hole({ green: { lat: 0, lng: 0 }, bunkers: [feature({ lat: 0, lng: 0 })] });
    expect(buildAimCandidates(g)).toEqual([]);
  });

  it('a bunker does NOT permanently shadow the green behind it — selection is by aim, not by nearest', () => {
    // aimedFeature picks the smallest lateral offset on purpose. Aim squarely at the green and the
    // nearer, off-line bunker must not steal the read.
    const g = hole({ green: at(180), bunkers: [feature(at(120, 20), 'right')] });
    const aimed = featureOnAimLine(TEE, 0, buildAimCandidates(g));
    expect(aimed!.label).toBe('green');
  });

  it('still refuses a target well off the aim line', () => {
    const g = hole({ green: at(137, 90) }); // ~33 degrees off
    expect(featureOnAimLine(TEE, 0, buildAimCandidates(g))).toBeNull();
  });
});
