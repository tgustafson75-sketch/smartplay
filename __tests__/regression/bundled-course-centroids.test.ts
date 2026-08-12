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

/**
 * 2026-08-11 (backtracking check) — the SECOND centroid table.
 *
 * Correcting the Play tab alone would have been a half-fix. courseGeometryService reads the lat/lng
 * it sends to the engine from LOCAL_COURSE_CENTROIDS in data/localCourseImages.ts, which carried the
 * SAME hand-typed errors — so the map would have looked right while the engine kept searching empty
 * ground and reporting "OSM unavailable". [[no-half-fixes-enforce-every-surface]]
 */
describe('the engine searches from the same corrected centroid the UI draws', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { LOCAL_COURSE_CENTROIDS } = require('../../data/localCourseImages');

  it.each(['greenhill', 'echo-hills', 'westlake-cc-nj'])(
    '%s — the engine table agrees with the derived centroid',
    slug => {
      const derived = getBundledCourseCentroid(slug)!;
      expect(derived).not.toBeNull();
      expect(haversineM(LOCAL_COURSE_CENTROIDS[slug], derived)).toBeLessThan(1);
    },
  );

  it('greenhill no longer sends the engine to Tatnuck Country Club', () => {
    // A ~1.5km search centered 6.8km away is why this course would never build.
    expect(haversineM(LOCAL_COURSE_CENTROIDS['greenhill'], { lat: 42.274306, lng: -71.861492 }))
      .toBeGreaterThan(3000);
  });

  it('keeps the literal for courses with no geometry to derive from', () => {
    // Four scorecard-only courses have no coordinates at all; their literal is load-bearing.
    expect(getBundledCourseCentroid('gleneagles-queens')).toBeNull();
    expect(LOCAL_COURSE_CENTROIDS['webster-dudley']).toBeDefined();
  });

  it('covers every slug — derivation must not drop entries', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('../../data/localCourseImages');
    expect(Object.keys(mod.LOCAL_COURSE_CENTROIDS).length).toBeGreaterThanOrEqual(30);
    for (const v of Object.values(mod.LOCAL_COURSE_CENTROIDS) as { lat: number; lng: number }[]) {
      expect(Number.isFinite(v.lat) && Number.isFinite(v.lng)).toBe(true);
    }
  });
});

/**
 * 2026-08-11 (continued QA) — the scorecard-only courses, which have no hole geometry to derive
 * from, so their hand-typed literal is load-bearing and had to be verified externally.
 *
 * Three more were wrong, and the comments on two of them show why "close enough" reasoning fails
 * here: Rancho's literal was annotated "any error <500m is invisible at city scale". It was 7.96km
 * out, in a different TOWN — and since the geometry engine searches ~1.5km around this exact point,
 * the error was the difference between building the course and reporting "OSM unavailable".
 *
 *   rancho-california  7959m — Temecula, but the course is in MURRIETA
 *   legacy-springfield 4850m — the literal was Springfield's town centre
 *   webster-dudley     1659m — self-described "approx town-center" placeholder
 */
describe('scorecard-only courses point at their actual course', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { LOCAL_COURSE_CENTROIDS } = require('../../data/localCourseImages');

  // Independently sourced 2026-08-11: OSM golf_course polygons and the US Census address geocoder,
  // which agreed with each other to 170m on Rancho.
  const truth: Record<string, { lat: number; lng: number }> = {
    'rancho-california': { lat: 33.562359, lng: -117.145761 }, // Census: 39500 Robert Trent Jones Pkwy
    'webster-dudley': { lat: 42.047568, lng: -71.924881 },     // OSM: Dudley Hill GC at Nichols College
  };

  it.each(Object.keys(truth))('%s — the engine searches from the real course', slug => {
    expect(haversineM(LOCAL_COURSE_CENTROIDS[slug], truth[slug])).toBeLessThan(500);
  });

  it('rancho-california is no longer in the wrong town', () => {
    // The old literal. A ~1.5km OSM search centered here found nothing, for months.
    expect(haversineM(LOCAL_COURSE_CENTROIDS['rancho-california'], { lat: 33.4910, lng: -117.1390 }))
      .toBeGreaterThan(5000);
  });

  it('shadow-lakes keeps its literal — it is the club street address, verified', () => {
    // Nominatim resolves "401 W Country Club Dr, Brentwood CA" to exactly this point. OSM has no
    // polygon for the club (it closed in 2018 and reopened), which is absence of data, not an error.
    expect(haversineM(LOCAL_COURSE_CENTROIDS['shadow-lakes'], { lat: 37.929130, lng: -121.752225 }))
      .toBeLessThan(50);
  });
});
