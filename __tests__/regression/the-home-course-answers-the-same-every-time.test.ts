/**
 * 2026-09-06 (Tim) — "don't tell me to check on course. Check. Make sure it works."
 *
 * Fair. The Menifee work earlier today was reported as Tier A — code-level only, pending a round on
 * the actual course. That was the wrong place to stop, because the defect it fixed is not one you
 * would reliably SEE on a round: the pin moved depending on whether SmartVision had been opened that
 * session, and a yardage that is quietly ten yards wrong on some holes and right on others looks
 * like a bad swing, not a bug. That is exactly why it survived a real round in the first place.
 *
 * So this asserts it instead of asking someone to notice it.
 *
 * WHAT BROKE, RESTATED: services/smartFinderService read a Golfbert pin cache ABOVE courseHoles, and
 * that cache had one populator in the whole app — SmartVision's mount effect. Open the map first and
 * the pin came from Golfbert; go straight to the caddie and it came from courseHoles. Same hole,
 * same round, two answers. The provider is deleted; these lock the properties that proves it.
 *
 * The live API cannot help here and that is not a failure: `local:palms` is our internal id, so
 * /api/course-geometry answers "Upstream 404" for it. Menifee runs on the bundled geometry in
 * data/courses.ts, which is what these read.
 */
import { useRoundStore } from '../../store/roundStore';
import { resolveGreenCoords, resolveTeeCoords, holeLengthYards } from '../../services/smartFinderService';
import { getBundledHoles } from '../../data/courses';
import { getHoleGeometry } from '../../services/courseGeometryService';

const LAYOUTS = ['local:palms', 'local:lakes'] as const;
/** Menifee Lakes CC sits at ~33.69, -117.15. Five km is generous for one property. */
const onProperty = (deg: number, centre: number) => Math.abs(deg - centre) * 111 < 5;

function startRoundAt(courseId: string) {
  const holes = getBundledHoles(courseId).map(h => ({
    hole: h.hole, par: h.par, distance: h.distance,
    teeLat: h.teeLat, teeLng: h.teeLng,
    middleLat: h.middleLat, middleLng: h.middleLng,
    frontLat: h.frontLat, frontLng: h.frontLng,
    backLat: h.backLat, backLng: h.backLng,
  }));
  useRoundStore.setState({
    isRoundActive: true,
    activeCourseId: courseId,
    activeCourse: courseId === 'local:palms' ? 'Menifee Lakes — Palms' : 'Menifee Lakes — Lakes',
    currentHole: 1,
    courseHoles: holes as never,
  } as never);
}

describe.each(LAYOUTS)('%s ships complete, on-property geometry', (id) => {
  it('has 18 holes, every one with a real tee and green', () => {
    const holes = getBundledHoles(id);
    expect(holes.length).toBe(18);
    // 0/0 is this file's "no coordinate" marker; a hole carrying it would drag yardages to the
    // Gulf of Guinea rather than fail loudly.
    const noGreen = holes.filter(h => !(Math.abs(h.middleLat) > 0.001 && Math.abs(h.middleLng) > 0.001));
    const noTee = holes.filter(h => !(Math.abs(h.teeLat) > 0.001 && Math.abs(h.teeLng) > 0.001));
    expect(noGreen.map(h => h.hole)).toEqual([]);
    expect(noTee.map(h => h.hole)).toEqual([]);
  });

  it('puts every hole on the actual property, at a plausible length', () => {
    for (const h of getBundledHoles(id)) {
      expect([h.hole, onProperty(h.middleLat, 33.69)]).toEqual([h.hole, true]);
      expect([h.hole, onProperty(h.middleLng, -117.15)]).toEqual([h.hole, true]);
      expect([h.hole, h.distance > 60 && h.distance < 700]).toEqual([h.hole, true]);
    }
  });

  it('getHoleGeometry answers for all 18', () => {
    for (let n = 1; n <= 18; n++) {
      expect([n, !!getHoleGeometry(id, n)?.green?.lat]).toEqual([n, true]);
    }
  });
});

describe.each(LAYOUTS)('%s: the pin the caddie actually uses', (id) => {
  it('resolves a pin on every hole, always from courseHoles', () => {
    startRoundAt(id);
    for (let n = 1; n <= 18; n++) {
      const g = resolveGreenCoords(n);
      expect([n, !!g.middle]).toEqual([n, true]);
      // THE REGRESSION: any other source here means a second provider is answering for this course.
      expect([n, g.source]).toEqual([n, 'courseHoles']);
    }
  });

  it('gives the same answer fifty times running', () => {
    // The failure was never "wrong", it was "different depending on what you opened first".
    startRoundAt(id);
    const first = JSON.stringify(resolveGreenCoords(7));
    for (let i = 0; i < 50; i++) {
      expect(JSON.stringify(resolveGreenCoords(7))).toBe(first);
    }
  });

  it('resolves a tee and a plausible hole length on all 18', () => {
    startRoundAt(id);
    for (let n = 1; n <= 18; n++) {
      expect([n, !!resolveTeeCoords(n).tee]).toEqual([n, true]);
      const yds = holeLengthYards(n);
      expect([n, yds !== null && yds > 60 && yds < 700]).toEqual([n, true]);
    }
  });
});

describe('the two layouts are two courses', () => {
  it('never return the same pin for the same hole number', () => {
    // The original field bug wore this exact shape: correct Palms yardages beside Lakes imagery.
    const pins: Record<string, string[]> = {};
    for (const id of LAYOUTS) {
      startRoundAt(id);
      pins[id] = Array.from({ length: 18 }, (_, i) => JSON.stringify(resolveGreenCoords(i + 1).middle));
    }
    const collisions = pins['local:palms']
      .map((p, i) => (p === pins['local:lakes'][i] ? i + 1 : null))
      .filter(Boolean);
    expect(collisions).toEqual([]);
  });
});
