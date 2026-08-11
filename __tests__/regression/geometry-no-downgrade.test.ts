/**
 * 2026-08-10 (Tim, after the round) — "you did not build this course engine correctly because most
 * of it didn't load correctly. And if the course doesn't load correctly and you don't do what I ask,
 * the whole app doesn't work right."
 *
 * MEASURED against production: pulling Connecticut National repeatedly, 1 in 6 calls came back with
 * ZERO greens even after adding three Overpass mirrors and a retry. The free community Overpass
 * endpoints throttle; that is their normal behavior and we cannot fix it from here.
 *
 * What we CAN fix is the consequence. That empty response used to be written straight over a
 * perfectly good cached course — so one unlucky refresh turned a working course into an empty one,
 * and it STAYED empty, because the empty version was now the cache. A transient upstream hiccup
 * became permanent local damage.
 *
 * These lock the rule: the cache never accepts a downgrade.
 */
import { mappedHoleCount } from '../../services/courseGeometryService';
import type { CourseGeometry, HoleGeometry } from '../../services/courseGeometryService';

const hole = (n: number, mapped: boolean): HoleGeometry =>
  ({
    hole_number: n,
    par: 4,
    yardage: 380,
    tee: mapped ? { lat: 41.9, lng: -71.8 } : null,
    green: mapped ? { lat: 41.901, lng: -71.801 } : null,
    green_front: null,
    green_back: null,
    bearing_deg: null,
    hazards: [],
    fairway_centerline: [],
    green_outline: [],
  }) as HoleGeometry;

const geo = (mappedCount: number): CourseGeometry =>
  ({
    course_id: 'f5qh3wf4',
    course_name: 'Connecticut National Golf Club',
    fetched_at: Date.now(),
    holes: Array.from({ length: 18 }, (_, i) => hole(i + 1, i < mappedCount)),
  }) as CourseGeometry;

describe('mappedHoleCount — the measure of "did this actually load"', () => {
  it('counts only holes carrying a real green', () => {
    expect(mappedHoleCount(geo(18))).toBe(18);
    expect(mappedHoleCount(geo(9))).toBe(9);
  });

  it('the production failure shape — 18 holes, zero greens — counts as ZERO', () => {
    // This is exactly what the endpoint returned: a full hole list, every green null.
    // Counting holes rather than greens is what made an empty course look like a loaded one.
    expect(mappedHoleCount(geo(0))).toBe(0);
  });

  it('handles null/empty geometry without throwing', () => {
    expect(mappedHoleCount(null)).toBe(0);
    expect(mappedHoleCount(undefined)).toBe(0);
    expect(mappedHoleCount({ holes: [] } as unknown as CourseGeometry)).toBe(0);
  });

  it('a fully-mapped course outranks an empty read, which is the whole downgrade rule', () => {
    expect(mappedHoleCount(geo(18))).toBeGreaterThan(mappedHoleCount(geo(0)));
  });

  it('a partial read outranks nothing but loses to a fuller one', () => {
    expect(mappedHoleCount(geo(4))).toBeGreaterThan(mappedHoleCount(geo(0)));
    expect(mappedHoleCount(geo(4))).toBeLessThan(mappedHoleCount(geo(18)));
  });
});
