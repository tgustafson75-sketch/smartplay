/**
 * 2026-10-13 (course-engine audit #7) — a surveyed green centre (on-foot truth) returned front/back as
 * null even when the hole's geometry held real edges: F and B were dashes on the best-mapped courses and
 * every declared pin was declined. Edges are borrowed only when they describe THIS green.
 */
import { setCourseTruth, clearCourseTruth } from '../../services/courseTruth';
import { resolveGreenCoords } from '../../services/smartFinderService';
import { useRoundStore, type CourseHole } from '../../store/roundStore';

const COURSE = 'truth-edges-test';
const centre = { lat: 33.7500, lng: -117.0500 };
const front = { lat: 33.74988, lng: -117.0500 };   // ~13 yd short
const back = { lat: 33.75012, lng: -117.0500 };    // ~13 yd long
const hole = (f: { lat: number; lng: number }, b: { lat: number; lng: number }): CourseHole => ({
  hole: 1, par: 4, distance: 380, front: 368, back: 392,
  teeLat: 33.7466, teeLng: -117.05, middleLat: centre.lat, middleLng: centre.lng,
  frontLat: f.lat, frontLng: f.lng, backLat: b.lat, backLng: b.lng, note: '', estimated: false,
} as CourseHole);

beforeEach(async () => {
  await setCourseTruth(COURSE, 1, centre);
  useRoundStore.setState({ isRoundActive: true, activeCourseId: COURSE, currentHole: 1 } as never);
});
afterEach(async () => { await clearCourseTruth(COURSE, 1); });

describe('a surveyed green keeps its edges', () => {
  it('edges that belong to this green are kept with the surveyed centre', () => {
    useRoundStore.setState({ courseHoles: [hole(front, back)] } as never);
    const g = resolveGreenCoords(1);
    expect(g.source).toBe('truth');
    expect(g.middle).toEqual(centre);
    expect(g.front).toEqual(front);
    expect(g.back).toEqual(back);
  });
  it('edges from another green (60 yd away) are not borrowed — dashes, as before', () => {
    const far = (d: number) => ({ lat: centre.lat + d, lng: centre.lng });
    useRoundStore.setState({ courseHoles: [hole(far(0.00055), far(0.0006))] } as never);
    const g = resolveGreenCoords(1);
    expect(g.source).toBe('truth');
    expect(g.front).toBeNull();
    expect(g.back).toBeNull();
  });
});
