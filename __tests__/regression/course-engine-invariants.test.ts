/**
 * COURSE ENGINE — invariant sweep. (Focus pass, 2026-08-19: Tim — "let's make sure there's no bugs
 * because that's super key for release.") Same method as the virtual market test: drive the REAL modules
 * with a generated population of realistic-and-awkward courses and assert properties that must hold
 * for every course, rather than expected outputs for one.
 */
import { courseToHoles, courseSummaryForContext } from '../../services/golfCourseApi';
import { pickTeeSet } from '../../services/teeSelection';
import { mergeCourseImports } from '../../services/courseImport';

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const int = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
const chance = (r: () => number, p: number) => r() < p;
const pick = <T,>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;

const findings: string[] = [];
const seenF = new Set<string>();
const flag = (k: string, detail: string) => { if (seenF.has(k)) return; seenF.add(k); findings.push(`[${k}] ${detail}`); };

/** A real course is 9/18/27 holes, sometimes with gaps, bad GPS, odd tee names. */
function makeCourse(seed: number) {
  const r = mulberry32(seed);
  const holeCount = pick(r, [9, 18, 18, 18, 27, 6]);
  const baseLat = (r() - 0.5) * 160;   // both hemispheres
  const baseLng = (r() - 0.5) * 360;   // includes antimeridian region
  const teeNames = ['Black', 'Blue', 'White', 'Gold', 'Red', 'Championship'];
  const teeCount = int(r, 1, 5);
  const tees = Array.from({ length: teeCount }, (_, ti) => {
    const holes = Array.from({ length: holeCount }, (_, i) => {
      const hasGps = chance(r, 0.7);
      return {
        hole_number: chance(r, 0.05) ? int(r, 1, holeCount) : i + 1,  // occasional duplicate/misorder
        par: pick(r, [3, 4, 4, 4, 5, 3]),
        yardage: chance(r, 0.08) ? pick(r, [0, -50, 99999, NaN as unknown as number]) : int(r, 90, 620),
        hazards: chance(r, 0.4) ? ['bunker left'] : [],
        gps: hasGps ? { lat: baseLat + r() * 0.01, lng: baseLng + r() * 0.01 } : null,
      };
    });
    return {
      tee_name: chance(r, 0.06) ? '' : teeNames[ti % teeNames.length],
      total_yards: chance(r, 0.1) ? (pick(r, [0, null]) as number) : int(r, 4800, 7600),
      par_total: int(r, 68, 74),
      course_rating: chance(r, 0.5) ? 71.2 : (null as unknown as number),
      slope_rating: chance(r, 0.5) ? 132 : (null as unknown as number),
      holes,
    };
  });
  return {
    id: seed, club_name: chance(r, 0.05) ? '' : `Course ${seed}`,
    course_name: `Course ${seed}`,
    location: { city: 'Testville', state: 'CT', country: 'US', latitude: baseLat, longitude: baseLng },
    tees,
  } as never;
}

describe('course engine — invariants across a generated course population', () => {
  it('holds for 400 courses', () => {
    for (let i = 0; i < 400; i++) {
      const seed = 5000 + i * 7919;
      const r = mulberry32(seed ^ 0x9e37);
      const course = makeCourse(seed);
      const c = course as unknown as { tees: { tee_name: string; total_yards: number; holes: unknown[] }[] };

      // ---- courseToHoles ----
      const requested = chance(r, 0.5) ? c.tees[int(r, 0, c.tees.length - 1)]!.tee_name : 'NoSuchTee';
      const holes = courseToHoles(course, requested);

      for (const h of holes) {
        for (const [k, v] of Object.entries(h)) {
          if (typeof v === 'number' && !Number.isFinite(v)) flag('non-finite field', `${k}=${String(v)} (seed ${seed})`);
        }
        if (typeof h.distance === 'number' && h.distance < 0) flag('negative hole distance', `hole ${h.hole} = ${h.distance} (seed ${seed})`);
        // NOTE: a missing GPS becomes 0,0 here, which IS a real place (Gulf of Guinea) — but the
        // CourseHole contract types these as numbers and every consumer traced gates on
        // isValidWgs84 / !== 0 before using them. Left as-is deliberately; asserted instead that a
        // PARTIAL coordinate never appears, which no guard downstream would catch.
        if ((h.teeLat === 0) !== (h.teeLng === 0)) {
          flag('half a coordinate', `hole ${h.hole} lat=${h.teeLat} lng=${h.teeLng} (seed ${seed})`);
        }
        if (Math.abs(h.teeLat) > 90) flag('latitude out of range', `hole ${h.hole} lat=${h.teeLat} (seed ${seed})`);
        if (Math.abs(h.teeLng) > 180) flag('longitude out of range', `hole ${h.hole} lng=${h.teeLng} (seed ${seed})`);
        // NOTE: front === back === distance is BY DESIGN here — a placeholder until real green
        // geometry lands. Every consumer gates on `back > front` before treating them as pin
        // distances (see app/smartvision.tsx), so it is not asserted against.
      }
      const nums = holes.map(h => h.hole);
      if (new Set(nums).size !== nums.length) flag('duplicate hole numbers survive into the round', `${nums.join(',')} (seed ${seed})`);

      /**
       * The real contract, and the one Tim's "Preferred Tee did nothing" report was about: when the
       * requested tee EXISTS, its own yardages must be used — never the first tee's. Falling back for
       * a tee that genuinely isn't on the course is correct (the round still has to render); it just
       * has to be logged, which it now is. So assert the case that actually loses the player's choice.
       */
      const real = c.tees.find(t => t.tee_name);
      if (real && real !== c.tees[0]) {
        const got = courseToHoles(course, real.tee_name);
        const want = (real.holes as { hole_number: number; yardage: number }[]);
        const seenN = new Set<number>();
        const expected = want.filter(h => Number.isFinite(h.hole_number) && !seenN.has(h.hole_number) && seenN.add(h.hole_number))
          .map(h => (typeof h.yardage === 'number' && Number.isFinite(h.yardage) && h.yardage > 0 && h.yardage <= 900 ? Math.round(h.yardage) : 0));
        if (JSON.stringify(got.map(h => h.distance)) !== JSON.stringify(expected)) {
          flag('a tee that EXISTS did not produce its own yardages', `"${real.tee_name}" (seed ${seed})`);
        }
      }

      // ---- courseSummaryForContext (goes to the AI brain verbatim) ----
      const summary = courseSummaryForContext(course);
      for (const bad of ['undefined', 'NaN', 'null']) {
        if (new RegExp(`\\b${bad}\\b`).test(summary)) flag(`brain context contains "${bad}"`, `${summary.slice(0, 120)}… (seed ${seed})`);
      }

      // ---- pickTeeSet ----
      for (const pref of ['front', 'middle', 'back'] as const) {
        const t = pickTeeSet(c.tees as never, pref);
        if (t == null && c.tees.length > 0) flag('tee selection returned nothing for a course with tees', `pref ${pref} (seed ${seed})`);
      }
      const measurable = c.tees.filter(t => typeof t.total_yards === 'number' && t.total_yards > 0);
      if (measurable.length >= 2) {
        const front = pickTeeSet(c.tees as never, 'front') as unknown as { total_yards: number };
        const back = pickTeeSet(c.tees as never, 'back') as unknown as { total_yards: number };
        if (front && back && front.total_yards > back.total_yards) {
          flag('front tee is LONGER than back tee', `${front.total_yards} > ${back.total_yards} (seed ${seed})`);
        }
      }
    }

    if (findings.length) {
      console.log('\n=== COURSE ENGINE FINDINGS ===');
      findings.forEach(f => console.log('  ' + f));
      console.log();
    }
    expect(findings).toEqual([]);
  });

  it('merges scorecard screenshots without inventing or losing holes', () => {
    const local: string[] = [];
    for (let i = 0; i < 200; i++) {
      const r = mulberry32(9000 + i * 104729);
      const parts = Array.from({ length: int(r, 0, 4) }, () => ({
        course_name: chance(r, 0.5) ? 'Split Rock' : null,
        tee_name: chance(r, 0.5) ? 'White' : null,
        location: null,
        confidence: pick(r, ['high', 'medium', 'low'] as const),
        warnings: [],
        holes: Array.from({ length: int(r, 0, 18) }, () => ({
          hole: int(r, 1, 18), par: pick(r, [3, 4, 5]), yardage: int(r, 90, 620),
        })),
      }));
      const merged = mergeCourseImports(parts as never);
      const inHoles = new Set(parts.flatMap(p => p.holes.map(h => h.hole)));
      const outHoles = merged.holes.map(h => h.hole);
      for (const h of outHoles) {
        if (!inHoles.has(h)) local.push(`merge INVENTED hole ${h} (i=${i})`);
        if (h < 1 || h > 18) local.push(`merge produced out-of-range hole ${h} (i=${i})`);
      }
      if (new Set(outHoles).size !== outHoles.length) local.push(`merge produced duplicate holes: ${outHoles.join(',')} (i=${i})`);
      for (const h of merged.holes) {
        if (!Number.isFinite(h.yardage as number) && h.yardage != null) local.push(`merge yardage non-finite (i=${i})`);
      }
    }
    if (local.length) { console.log('\n=== MERGE FINDINGS ==='); [...new Set(local)].slice(0, 10).forEach(f => console.log('  ' + f)); }
    expect([...new Set(local)]).toEqual([]);
  });
});
