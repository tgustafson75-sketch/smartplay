/**
 * 2026-09-10 (Tim, on the course: "I turned on auto scoring and auto shot detection and movement
 * and it doesn't seem to be working seamlessly") — AUTO HOLE ADVANCE READ THE ONE SOURCE THAT WAS
 * EMPTY.
 *
 * `detectCurrentHole` asked `getHoleGeometry()` — the geometry CACHE — and nothing else. Every other
 * consumer asks smartFinderService, whose cascade is surveyed truth → the player's Mark Green / Mark
 * Tee override → `roundStore.courseHoles` → and only then that same cache.
 *
 * On a golfcourseapi course the gap is total. `courseToHoles` writes the API's per-hole `gps` into
 * teeLat/teeLng and writes ZERO into every green field, because the free tier ships tees and null
 * greens. So until an OSM/derivation build lands a green in the cache, the detector returned
 * `no current-hole green geometry` on EVERY fix — toggle showing ON, nothing on screen saying why —
 * while the real tee coordinates sat in courseHoles the whole time. It also made the app's own
 * documented remedy useless: Mark Green writes an OVERRIDE, which the cache does not carry.
 *
 * This test is functional rather than a source scan: it drives the detector with an EMPTY geometry
 * cache and only courseHoles populated, which is exactly the Hemet Golf Club shape.
 */
import { detectCurrentHole } from '../../services/holeDetection';
import { useRoundStore, type CourseHole } from '../../store/roundStore';
import { purgeCourseGeometry } from '../../services/courseGeometryService';
import { setGreenOverride, clearGreenOverride } from '../../services/courseGreenOverrides';

const COURSE = 'gca-hemet-test';

/** Two holes ~300y apart, shaped the way courseToHoles emits a golfcourseapi course. */
const TEE_1 = { lat: 33.7400, lng: -116.9700 };
const GREEN_1 = { lat: 33.7427, lng: -116.9700 };   // ~300y north of tee 1
const TEE_2 = { lat: 33.7432, lng: -116.9700 };     // ~55y past green 1

function apiShapedHole(hole: number, tee: { lat: number; lng: number }): CourseHole {
  return {
    hole, par: 4, distance: 300, front: 300, back: 300,
    teeLat: tee.lat, teeLng: tee.lng,
    // The whole point: golfcourseapi gives no greens, so courseToHoles writes zeros.
    middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0,
    note: '', estimated: false,
  } as CourseHole;
}

beforeEach(async () => {
  purgeCourseGeometry(COURSE);           // the cache is EMPTY — this is the condition under test
  await clearGreenOverride(COURSE, 1).catch(() => undefined);
  useRoundStore.setState({
    isRoundActive: true,
    activeCourseId: COURSE,
    currentHole: 1,
    courseHoles: [apiShapedHole(1, TEE_1), apiShapedHole(2, TEE_2)],
  } as never);
});

describe('auto hole advance on a course whose geometry cache is empty', () => {
  it('finds the current green through the resolver, not only the cache', async () => {
    // The player walked up and tapped Mark Green — the app's own documented remedy for a course
    // with no geometry. That writes an OVERRIDE, which the cache does not carry, so before this fix
    // the detector STILL returned "no current-hole green geometry" and refused to evaluate at all.
    await setGreenOverride(COURSE, 1, GREEN_1);
    const res = detectCurrentHole(GREEN_1, COURSE, 1, {});
    expect(res.reason).not.toMatch(/no current-hole green geometry/);
  });

  it('sees the next tee, which lives in courseHoles and never reaches the cache', async () => {
    // Score hole 1, then stand on hole 2's tee. The advance rules need a candidate tee: the cache
    // has none, courseHoles has the real one straight from golfcourseapi.
    await setGreenOverride(COURSE, 1, GREEN_1);
    const res = detectCurrentHole(TEE_2, COURSE, 1, { 1: 4 });
    expect(res.hole_number).toBe(2);
    expect(res.transition_recommended).toBe(true);
  });

  it('still refuses to act when there is genuinely no green anywhere', () => {
    // No override, no cache, courseHoles greens are zeros — the honest answer is still "I cannot
    // tell", not a fabricated transition.
    const res = detectCurrentHole(TEE_2, COURSE, 1, { 1: 4 });
    expect(res.transition_recommended).toBe(false);
    expect(res.reason).toMatch(/no current-hole green geometry/);
  });
});
