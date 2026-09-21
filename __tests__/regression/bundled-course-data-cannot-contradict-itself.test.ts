/**
 * 2026-09-20 (final sweep, Tim: "check round play, course engine, and smartmotion one more time") —
 * TWO THINGS THE BUNDLED DATA WAS SAYING THAT COULD NOT BOTH BE TRUE.
 *
 * 1. A HOLE CLAIMING MEASURED GEOMETRY IT DOES NOT HAVE. `estimated` is the flag the app uses to
 *    admit it is working from a scorecard: app/smartvision renders its "estimated" badge off it and
 *    services/courseDataOrchestrator caps geometry confidence at 45 when it is set. Webster-Dudley
 *    shipped eighteen holes with 0/0 coordinates and `estimated: false` — full confidence, no
 *    badge, for a course nobody has surveyed. 108 other coordinate-less holes were flagged
 *    correctly; this was the one course that was not.
 *
 * 2. A CARD DISTANCE OUTSIDE ITS OWN FRONT AND BACK. Menifee Lakes (Tim's home club) played hole 9
 *    at 491 with a back of 476, hole 14 at 379 with a back of 364, hole 17 at 128 off a front of
 *    130. services/holeContextResolver hands the caddie "par 4, 379 yards (front 336, back 364)"
 *    and he clubs off it.
 *
 *    Which number was wrong was MEASURED: tee→middle agreed with the card on 18 of 18 holes there,
 *    so the card and the coordinates were both right and the front/back scalars were the error.
 *    They were replaced with the distances to the frontLat/backLat this file already ships.
 *
 * Both are the same class — the data disagreeing with itself while every gate stayed green, because
 * nothing compared the fields to each other. [[illustration-data-points]]
 */
import { COURSES, getBundledHoles } from '../../data/courses';

const R = 6371000 * 1.09361;
function yards(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const t = (d: number) => (d * Math.PI) / 180;
  const dLat = t(b.lat - a.lat);
  const dLng = t(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(t(a.lat)) * Math.cos(t(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(s));
}
const real = (la: number, ln: number) => Math.abs(la) > 0.001 && Math.abs(ln) > 0.001;

describe('bundled course data cannot contradict itself', () => {
  it('there are courses to check — never pass vacuously', () => {
    expect(COURSES.length).toBeGreaterThanOrEqual(30);
    expect(COURSES.reduce((a, c) => a + c.holes.length, 0)).toBeGreaterThanOrEqual(500);
  });

  it('a hole with no green never claims to be measured', () => {
    const lying = COURSES.flatMap((c) =>
      c.holes
        .filter((h) => !real(h.middleLat, h.middleLng) && h.estimated === false)
        .map((h) => `${c.id} h${h.hole}`),
    );
    expect(lying).toEqual([]);
  });

  it('the card distance sits between the front and the back of its own green', () => {
    const contradictory = COURSES.flatMap((c) =>
      c.holes
        .filter((h) => h.distance > 0 && h.front > 0 && h.back > 0)
        .filter((h) => h.distance < h.front || h.distance > h.back)
        .map((h) => `${c.id} h${h.hole}: card ${h.distance} vs front ${h.front} back ${h.back}`),
    );
    expect(contradictory).toEqual([]);
  });

  it('front is never BEYOND back', () => {
    /**
     * `>` and not `>=`. A scorecard-only course honestly collapses front = middle = back = the card
     * distance, because no green depth is known — shadow-lakes does exactly that on all eighteen,
     * flagged estimated: true. That is the documented degrade, not a defect, and my first version of
     * this assertion called it one. What cannot happen is a front that is FURTHER than the back.
     */
    const inverted = COURSES.flatMap((c) =>
      c.holes.filter((h) => h.front > 0 && h.back > 0 && h.front > h.back).map((h) => `${c.id} h${h.hole}`),
    );
    expect(inverted).toEqual([]);
  });

  it('a collapsed front/back comes with an honest estimated flag', () => {
    // front == back means "we do not know the green's depth". A hole may only say that while also
    // admitting the geometry is estimated, or it is claiming a measured green one yard deep.
    const collapsedButClaimingMeasured = COURSES.flatMap((c) =>
      c.holes
        .filter((h) => h.front > 0 && h.front === h.back && h.estimated === false)
        .map((h) => `${c.id} h${h.hole}`),
    );
    expect(collapsedButClaimingMeasured).toEqual([]);
  });

  it('holes are numbered 1..n with no gaps', () => {
    const bad = COURSES.filter((c) => {
      const want = Array.from({ length: c.holes.length }, (_, i) => i + 1);
      return JSON.stringify(c.holes.map((h) => h.hole)) !== JSON.stringify(want);
    }).map((c) => c.id);
    expect(bad).toEqual([]);
  });

  it('the declared par equals the sum of the holes', () => {
    const bad = COURSES
      .filter((c) => c.par > 0 && c.holes.reduce((a, h) => a + h.par, 0) !== c.par)
      .map((c) => `${c.id}: declared ${c.par}, holes sum ${c.holes.reduce((a, h) => a + h.par, 0)}`);
    expect(bad).toEqual([]);
  });

  it('a tee that survives validation agrees with its own scorecard', () => {
    // The contract validateBundledTees exists to enforce — asserted on the RUNTIME holes, which is
    // what every consumer actually sees.
    const bad: string[] = [];
    for (const c of COURSES) {
      for (const h of getBundledHoles(`local:${c.id}`)) {
        if (!real(h.teeLat, h.teeLng) || !real(h.middleLat, h.middleLng) || !(h.distance > 0)) continue;
        const ratio = yards({ lat: h.teeLat, lng: h.teeLng }, { lat: h.middleLat, lng: h.middleLng }) / h.distance;
        if (ratio > 1.35 || ratio < 0.65) bad.push(`${c.id} h${h.hole} (${ratio.toFixed(2)}x)`);
      }
    }
    expect(bad).toEqual([]);
  });
});
