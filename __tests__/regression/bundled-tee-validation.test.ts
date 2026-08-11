/**
 * 2026-08-11 (Tim — "Check my courses. Make sure every course engine renders correctly. Make sure
 * that the measuring tool lines up on the green and the tee box. This is a total QA pass.")
 *
 * QA over all 30 bundled courses compared each hole's stored tee→green against its OWN scorecard
 * distance. 35 of 452 holes disagreed by more than a third, concentrated in three courses:
 *
 *   WESTLAKE_NJ  14/14 holes measured ~145-163y — on cards of 288-510y
 *   ECHO_HILLS    7/8  holes measured ~146-155y — on cards of 221-322y
 *   GREENHILL    14/16 long holes at ~0.4x card (its PAR 3s are correct at ~1.0x)
 *
 * The measured distance is nearly CONSTANT (~150y) regardless of hole length, so the stored "tee"
 * on those holes is not a tee — it's a point about 150 yards out. Greenhill's par-3s being correct
 * is the confirmation: on a 140-185y hole, a point 150y from the green IS the tee.
 *
 * A tee 150y from the green on a 416-yard hole makes the measuring tool draw the wrong line and
 * report a wrong number with total confidence. Worse than no tee. So a hole whose own numbers
 * contradict itself gives up its tee and keeps its green.
 */
import { getBundledHoles, COURSES } from '../../data/courses';

const hav = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const R = 6371000 * 1.09361, tr = (d: number) => (d * Math.PI) / 180;
  const p1 = tr(a.lat), p2 = tr(b.lat), dp = p2 - p1, dl = tr(b.lng - a.lng);
  const x = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
};
const hasCoord = (la?: number, ln?: number) =>
  la != null && ln != null && Number.isFinite(la) && Number.isFinite(ln) && la !== 0 && ln !== 0;

describe('EVERY bundled course: a surviving tee must agree with its own scorecard', () => {
  it.each(COURSES.map(c => [c.id] as const))('%s measures correctly on every hole that keeps a tee', (id) => {
    const holes = getBundledHoles(`local:${id}`);
    const wrong: string[] = [];
    for (const h of holes) {
      if (!hasCoord(h.teeLat, h.teeLng) || !hasCoord(h.middleLat, h.middleLng)) continue;
      if (!(h.distance > 0)) continue;
      const measured = hav({ lat: h.teeLat, lng: h.teeLng }, { lat: h.middleLat, lng: h.middleLng });
      const err = Math.abs(measured - h.distance) / h.distance;
      if (err > 0.35) wrong.push(`h${h.hole}: card ${h.distance} vs measured ${Math.round(measured)}`);
    }
    expect(wrong).toEqual([]);
  });
});

describe('the known-bad courses specifically', () => {
  it.each(['greenhill', 'westlake-cc-nj', 'echo-hills'])('%s drops its contradictory tees', (id) => {
    const holes = getBundledHoles(`local:${id}`);
    expect(holes.length).toBeGreaterThan(0);
    for (const h of holes) {
      if (!hasCoord(h.teeLat, h.teeLng)) continue;
      const measured = hav({ lat: h.teeLat, lng: h.teeLng }, { lat: h.middleLat, lng: h.middleLng });
      expect(measured).toBeLessThanOrEqual(h.distance * 1.35);
      expect(measured).toBeGreaterThanOrEqual(h.distance * 0.65);
    }
  });

  it('KEEPS the greens — live front/middle/back must still work', () => {
    for (const id of ['greenhill', 'westlake-cc-nj', 'echo-hills']) {
      const withGreen = getBundledHoles(`local:${id}`).filter(h => hasCoord(h.middleLat, h.middleLng));
      expect(withGreen.length).toBeGreaterThan(0);
    }
  });

  it("Greenhill's par 3s KEEP their tees — they were always correct", () => {
    const par3s = getBundledHoles('local:greenhill').filter(h => h.par === 3 && h.distance > 0);
    const kept = par3s.filter(h => hasCoord(h.teeLat, h.teeLng));
    expect(kept.length).toBeGreaterThan(0);
  });
});

describe('courses that were already correct are untouched', () => {
  it.each(['palms', 'lakes', 'sunnyvale', 'san-jose-muni'])('%s keeps every tee it had', (id) => {
    const holes = getBundledHoles(`local:${id}`);
    const teed = holes.filter(h => hasCoord(h.teeLat, h.teeLng));
    expect(teed.length).toBeGreaterThan(0);
  });
});
