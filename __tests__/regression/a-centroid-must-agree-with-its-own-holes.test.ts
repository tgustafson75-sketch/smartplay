/**
 * 2026-09-20 — found while checking Echo Hills before Tim drove to Hemet to play it.
 *
 * THE CLAIM I FIRST WROTE HERE WAS WRONG, and it is worth recording because it is the more useful
 * lesson. I measured three LOCAL_COURSE_CENTROIDS_RAW literals against their own greens — echo-hills
 * 2,894 yards out, greenhill 7,441, westlake-cc-nj 3,645 — and reported a live bug: that the
 * 2026-08-11 fix in app/(tabs)/play.tsx was half a fix, and that app/smartvision.tsx and
 * services/courseGeometryService were reading kilometres-stale points.
 *
 * They were not. LOCAL_COURSE_CENTROIDS is DERIVED at module load:
 *
 *     out[slug] = getBundledCourseCentroid(slug) ?? LOCAL_COURSE_CENTROIDS_RAW[slug];
 *
 * so every consumer of the exported map already gets the mean of the course's own holes. The
 * 08-11 pass fixed the class properly at the owner. I found a bad NUMBER and asserted a bad
 * BEHAVIOUR without tracing the export that number feeds. [[state-what-you-measured-not-what-you-intended]]
 *
 * WHAT IS ACTUALLY WORTH GUARDING, and why this file still exists:
 *
 * The raw literal is the FALLBACK — `getBundledCourseCentroid` returns null when a course has fewer
 * than 3 usable points, and then the literal is the only answer anyone gets. It is also what a
 * person reads when they want to know where a course is. A literal that disagrees with the course's
 * own holes by kilometres is a loaded gun for the day someone's geometry thins out, and a trap for
 * the next reader either way. [[a-stale-header-is-a-source-someone-trusts]]
 *
 * So this reads the RAW map, not the derived export. Asserting against the export is the mistake
 * that let the first version of this test pass with a deliberately wrong literal restored — the
 * break-test is what caught it. [[break-test-every-guard-you-write]]
 */
import { __testing } from '../../data/localCourseImages';
import { COURSES } from '../../data/courses';

const { LOCAL_COURSE_CENTROIDS_RAW } = __testing;

/** Yards between two WGS84 points. */
function haversineYards(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000 * 1.09361;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(s));
}

/**
 * The at-course radius app/(tabs)/play.tsx uses to decide you have ARRIVED. A literal further than
 * this from the course's own holes is not a rounding error — it is a different place.
 */
const AT_COURSE_YARDS = 550;

/** 0/0 is data/courses.ts's "coordinate unknown" marker — averaging it in lands you off Africa. */
const usable = (p: { lat: number; lng: number }) =>
  Math.abs(p.lat) > 0.001 && Math.abs(p.lng) > 0.001
  && Number.isFinite(p.lat) && Number.isFinite(p.lng);

const raw = LOCAL_COURSE_CENTROIDS_RAW as Record<string, { lat: number; lng: number } | undefined>;

const withGeometry = COURSES
  .map((c) => {
    const pts = c.holes
      .flatMap((h) => [{ lat: h.teeLat, lng: h.teeLng }, { lat: h.middleLat, lng: h.middleLng }])
      .filter(usable);
    return { id: c.id, pts, literal: raw[c.id] };
  })
  .filter((c) => c.pts.length > 0 && c.literal);

describe('a hand-typed course centre agrees with the course', () => {
  it('there are bundled courses to check — never pass vacuously', () => {
    expect(withGeometry.length).toBeGreaterThanOrEqual(5);
  });

  it.each(withGeometry.map((c) => [c.id] as const))(
    '%s: the RAW literal is inside the at-course radius of its own holes',
    (id) => {
      const c = withGeometry.find((x) => x.id === id)!;
      const centre = {
        lat: c.pts.reduce((s, p) => s + p.lat, 0) / c.pts.length,
        lng: c.pts.reduce((s, p) => s + p.lng, 0) / c.pts.length,
      };
      const off = haversineYards(c.literal!, centre);
      expect({ id, offYards: Math.round(off) }).toEqual({ id, offYards: expect.any(Number) });
      expect(off).toBeLessThan(AT_COURSE_YARDS);
    },
  );

  it('reads the raw literals, not the derived export — or it cannot fail', () => {
    // The whole point of the retarget. If someone re-points this at LOCAL_COURSE_CENTROIDS, every
    // case above becomes "the mean of these holes is near the mean of these holes".
    const src = require('fs').readFileSync(__filename, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(src).toMatch(/LOCAL_COURSE_CENTROIDS_RAW/);
    expect(src).not.toMatch(/import\s*\{[^}]*\bLOCAL_COURSE_CENTROIDS\b[^}]*\}/);
  });
});
