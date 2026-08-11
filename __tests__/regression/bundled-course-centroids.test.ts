/**
 * 2026-08-11 — every bundled course must know where it actually is.
 *
 * Tim, on the total-QA pass: "Check my courses. Make sure every course engine renders correctly."
 *
 * Each bundled course carried a HAND-TYPED lat/lng, used for the distance sort, the Play-tab
 * thumbnail and the pre-round preview, and consumed by the geometry engine as the center of its
 * ~1.5km search. Nothing ever checked those numbers against the course's own hole coordinates.
 * Three were wrong:
 *
 *   greenhill       6803m off — the literal sat on TATNUCK COUNTRY CLUB, a different golf course
 *   westlake-cc-nj  3326m off
 *   echo-hills      2649m off
 *
 * Confirmed against OSM independently: "Green Hill Golf Course" is 31m from the geometry-derived
 * centroid; Echo Hills and Westlake agree to 13m and 110m. All three had been reporting "OSM
 * unavailable" when the engine tried to build them — the search was centered on empty ground.
 *
 * getBundledCourseCentroid now derives the point from real tee/green geometry. These lock that
 * derivation and, more importantly, lock that NO bundled course can disagree with its own holes.
 */
import { COURSES, getBundledCourseCentroid } from '../../data/courses';

const R = 6371000;
const haversineM = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const rad = (d: number) => (d * Math.PI) / 180;
  const x =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};

const withGeometry = COURSES.filter(c => getBundledCourseCentroid(c.id) !== null);

describe('a derived centroid sits on its own course', () => {
  it('covers the bundled catalog — this is not vacuously passing', () => {
    // If a refactor stops geometry resolving, the per-course loop below would silently test nothing.
    expect(withGeometry.length).toBeGreaterThanOrEqual(25);
  });

  it.each(withGeometry.map(c => [c.id] as const))(
    '%s — every hole lies within 4km of the centroid',
    id => {
      const centroid = getBundledCourseCentroid(id)!;
      const holes = (COURSES.find(c => c.id === id)?.holes ?? []).filter(
        h => Math.abs(h.middleLat) > 0.001 && Math.abs(h.middleLng) > 0.001,
      );
      for (const h of holes) {
        // A golf course fits inside a couple of km. Anything past 4km means the centroid is on a
        // different property, or a hole coordinate is from a different course.
        expect(haversineM(centroid, { lat: h.middleLat, lng: h.middleLng })).toBeLessThan(4000);
      }
    },
  );
});

describe('the three courses that were pointing at the wrong place', () => {
  // Ground truth from OSM (Overpass leisure=golf_course), verified 2026-08-11.
  const truth: Record<string, { lat: number; lng: number }> = {
    greenhill: { lat: 42.285637, lng: -71.777421 },
    'echo-hills': { lat: 33.72447, lng: -116.96509 },
    'westlake-cc-nj': { lat: 40.100838, lng: -74.286812 },
  };

  it.each(Object.keys(truth))('%s resolves to the real course, not the old literal', id => {
    const c = getBundledCourseCentroid(id);
    expect(c).not.toBeNull();
    // 400m of a large course's OSM center is a bullseye; the errors being fixed were 2.6-6.8km.
    expect(haversineM(c!, truth[id])).toBeLessThan(400);
  });

  it('greenhill no longer resolves anywhere near Tatnuck Country Club', () => {
    const tatnuck = { lat: 42.274306, lng: -71.861492 };
    expect(haversineM(getBundledCourseCentroid('greenhill')!, tatnuck)).toBeGreaterThan(3000);
  });
});

describe('derivation cannot be poisoned', () => {
  it('ignores the 0/0 no-coordinate marker rather than averaging it in', () => {
    // validateBundledTees zeroes tees that fail the yardage check, and scorecard-only holes are 0/0.
    // Averaging those would drag every affected centroid toward the Gulf of Guinea.
    for (const c of withGeometry) {
      expect(Math.abs(getBundledCourseCentroid(c.id)!.lat)).toBeGreaterThan(0.01);
    }
  });

  it('returns null — not a garbage point — for a course with no geometry at all', () => {
    expect(getBundledCourseCentroid('a-course-that-does-not-exist')).toBeNull();
  });

  it('accepts a local: prefixed id, which is how the Play tab holds them', () => {
    expect(getBundledCourseCentroid('local:greenhill')).toEqual(getBundledCourseCentroid('greenhill'));
  });
});
