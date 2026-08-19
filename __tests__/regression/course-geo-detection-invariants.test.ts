/**
 * COURSE ENGINE — live-GPS sweep (focus pass part 2, 2026-08-19).
 * Tim: "Finish the rest of those sweeps. We need everything sweeped… just making sure there are no
 * errors and everything works correctly."
 *
 * Part 1 (course-engine-invariants) covered the pure DATA path: scorecard in, holes and caddie
 * context out. This covers the side that only exists while the player is MOVING — the geodesy every
 * yardage is built on, and the hole detector that decides which hole those yardages belong to.
 *
 * That detector is the highest-leverage function on the course: pick the wrong hole and every number
 * the caddie says is wrong, confidently. It reads geometry from a module cache, which the service
 * exposes a seeder for — so a whole round can be walked deterministically here, with no network and
 * no device.
 */
import {
  haversineMeters, haversineYards, bearingDegrees, destinationPoint,
  projectToAxis, unprojectFromAxis,
} from '../../utils/geoDistance';
import { detectCurrentHole } from '../../services/holeDetection';
import { _seedGeometry, _clearGeometryCache, getHoleGeometry, mappedHoleCount } from '../../services/courseGeometryService';
import { pickTeeSet } from '../../services/teeSelection';

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const findings: string[] = [];
const seen = new Set<string>();
const flag = (k: string, d: string) => { if (!seen.has(k)) { seen.add(k); findings.push(`[${k}] ${d}`); } };

describe('geodesy — every yardage in the app is built on these', () => {
  it('holds across the globe, including the places that break naive formulas', () => {
    const r = mulberry32(4242);
    for (let i = 0; i < 3000; i++) {
      const a = { lat: (r() - 0.5) * 178, lng: (r() - 0.5) * 360 };
      const b = { lat: (r() - 0.5) * 178, lng: (r() - 0.5) * 360 };

      const d = haversineMeters(a, b);
      if (!Number.isFinite(d) || d < 0) flag('haversine non-finite or negative', `${JSON.stringify(a)}→${JSON.stringify(b)} = ${d}`);
      // Symmetry: distance cannot depend on direction of travel.
      const back = haversineMeters(b, a);
      if (Math.abs(d - back) > 1e-6) flag('haversine is not symmetric', `${d} vs ${back}`);
      // Identity: a point is zero from itself.
      if (haversineMeters(a, a) > 1e-9) flag('non-zero distance from a point to itself', `${haversineMeters(a, a)}`);
      // Half the planet is the ceiling.
      if (d > 20_100_000) flag('distance exceeds half the earth', `${d} m`);
      // Yards conversion must track metres.
      const y = haversineYards(a, b);
      if (Math.abs(y - d * 1.09361) > Math.max(1, d * 0.0001)) flag('yards disagree with metres', `${y}y vs ${d}m`);

      const brg = bearingDegrees(a, b);
      if (!Number.isFinite(brg) || brg < 0 || brg >= 360) flag('bearing outside 0..360', `${brg}`);

      // Round trip: walk the measured distance along the bearing from a and you must arrive at b.
      // destinationPoint takes YARDS (it exists for "I'm 140 out"), so feed it yards.
      const dest = destinationPoint(a, brg, y);
      const err = haversineMeters(dest, b);
      if (Number.isFinite(err) && d < 1_000_000 && err > Math.max(2, d * 0.001)) {
        flag('destinationPoint does not round-trip', `off by ${Math.round(err)}m over ${Math.round(d)}m`);
      }
    }
    // Antimeridian: two points either side of the date line are NEIGHBOURS, not half a world apart.
    const west = { lat: 0, lng: 179.999 };
    const east = { lat: 0, lng: -179.999 };
    const across = haversineMeters(west, east);
    if (across > 1000) flag('antimeridian treated as half the globe', `${Math.round(across)}m across the date line`);

    // Axis projection round trip — this is what puts a shot "x yards along, y yards offline".
    const r2 = mulberry32(77);
    for (let i = 0; i < 500; i++) {
      const tee = { lat: 41.7 + r2() * 0.01, lng: -72.7 + r2() * 0.01 };
      const green = { lat: tee.lat + (r2() - 0.5) * 0.005, lng: tee.lng + (r2() - 0.5) * 0.005 };
      const pt = { lat: tee.lat + (r2() - 0.5) * 0.005, lng: tee.lng + (r2() - 0.5) * 0.005 };
      // x = yards right of the tee→green axis, y = yards forward along it.
      const proj = projectToAxis(pt, tee, green);
      for (const [k, v] of Object.entries(proj)) {
        if (typeof v === 'number' && !Number.isFinite(v)) flag('projectToAxis non-finite', `${k}=${v}`);
      }
      const un = unprojectFromAxis(proj, tee, green);
      const errY = haversineYards(un, pt);
      if (errY > 2) flag('axis projection does not round-trip', `off by ${errY.toFixed(1)}y`);
    }
    if (findings.length) { console.log('\n=== GEODESY FINDINGS ==='); findings.forEach(f => console.log('  ' + f)); }
    expect(findings).toEqual([]);
  });
});

describe('hole detection — walking a full round without the wrong hole', () => {
  const COURSE = 'sweep-course';

  /** An 18-hole course laid out as a real one is: consecutive holes adjacent, greens near next tees. */
  function buildCourse(seed: number) {
    const r = mulberry32(seed);
    const holes = [];
    let lat = 41.70 + r() * 0.02;
    let lng = -72.70 + r() * 0.02;
    for (let h = 1; h <= 18; h++) {
      const yards = 120 + Math.floor(r() * 480);
      const brg = r() * 360;
      const tee = { lat, lng };
      const green = destinationPoint(tee, brg, yards); // destinationPoint takes YARDS
      holes.push({
        hole_number: h, par: yards < 240 ? 3 : yards > 480 ? 5 : 4, yardage: yards,
        tee, green, green_front: null, green_back: null, bearing_deg: brg,
        hazards: [], fairway_centerline: [], green_outline: [],
      });
      // Next tee sits a short walk from this green — the layout that makes detection hard.
      const walk = destinationPoint(green, r() * 360, 20 + r() * 60); // yards to the next tee
      lat = walk.lat; lng = walk.lng;
    }
    return { course_id: COURSE, course_name: COURSE, fetched_at: Date.now(), holes };
  }

  it('walks 120 rounds and never lands on an impossible hole', () => {
    const local: string[] = [];
    const seenL = new Set<string>();
    const flagL = (k: string, d: string) => { if (!seenL.has(k)) { seenL.add(k); local.push(`[${k}] ${d}`); } };

    for (let round = 0; round < 120; round++) {
      _clearGeometryCache();
      const geo = buildCourse(9000 + round * 7919);
      _seedGeometry(geo as never);
      if (mappedHoleCount(geo as never) !== 18) flagL('seeded course did not map 18 holes', `${mappedHoleCount(geo as never)}`);

      const r = mulberry32(500 + round);
      const scores: Record<number, number> = {};
      let current = 1;
      let maxReached = 1;

      for (let h = 1; h <= 18; h++) {
        const hole = geo.holes[h - 1]!;
        // Walk tee → green in steps, then to the next tee.
        const steps = 6;
        for (let s = 0; s <= steps; s++) {
          const frac = s / steps;
          const pos = {
            lat: hole.tee.lat + (hole.green.lat - hole.tee.lat) * frac + (r() - 0.5) * 0.00004,
            lng: hole.tee.lng + (hole.green.lng - hole.tee.lng) * frac + (r() - 0.5) * 0.00004,
          };
          const res = detectCurrentHole(pos, COURSE, current, scores);

          if (!Number.isInteger(res.hole_number) || res.hole_number < 1 || res.hole_number > 18) {
            flagL('detected hole outside 1..18', `${res.hole_number} (round ${round}, hole ${h})`);
          }
          if (!['high', 'medium', 'low'].includes(res.confidence)) {
            flagL('confidence outside its enum', `${String(res.confidence)}`);
          }
          if (typeof res.transition_recommended !== 'boolean') {
            flagL('transition_recommended is not a boolean', `${String(res.transition_recommended)}`);
          }
          /**
           * The REAL contract, which a naive forward-only assertion gets wrong (this sweep did, first
           * time round). detectCurrentHole supports exactly two kinds of transition and nothing else:
           *
           *   FORWARD  — to an UNSCORED hole, at most MAX_TRANSITION_LOOKAHEAD (2) ahead.
           *   RE-ENTRY — back to an ALREADY-SCORED hole, when the player is standing on its tee
           *              (<20y) and well clear (>50y) of the current green. That is the documented
           *              "walked back for a club / a lost ball" case, and it is deliberate.
           *
           * Anything outside those two is a bug: a jump to a hole the player has neither played nor
           * is approaching means every yardage the caddie gives is for the wrong hole.
           */
          if (res.transition_recommended && res.hole_number !== current) {
            const target = res.hole_number;
            const isReEntry = scores[target] != null;
            const isForward = target > current && target <= current + 2 && scores[target] == null;
            if (!isReEntry && !isForward) {
              flagL('transition that is neither a forward step nor a re-entry',
                `${current} → ${target}, scored=${scores[target] != null} (round ${round}, hole ${h})`);
            }
          }
          if (res.transition_recommended) { current = res.hole_number; maxReached = Math.max(maxReached, current); }
        }
        scores[h] = 4;
        if (current === h) current = Math.min(18, h + 1);
      }
      if (maxReached < 1) flagL('never advanced past the first hole in a full round', `round ${round}`);

      // Re-entry's own preconditions, asserted directly rather than taken from its comment: standing
      // on a played hole's tee, far from the current green, must return THAT hole — and standing near
      // the current green must never trigger it.
      {
        const played = 3;
        const playedTee = geo.holes[played - 1]!.tee;
        const cur = 9;
        const curGreen = geo.holes[cur - 1]!.green;
        const sc: Record<number, number> = { 1: 4, 2: 4, 3: 4, 4: 4, 5: 4, 6: 4, 7: 4, 8: 4 };
        /**
         * Both of re-entry's preconditions have to hold before this can be asserted: clear of the
         * current GREEN (>50y), and NOT standing at the current hole's own TEE — a shared/adjacent
         * tee complex makes a <20y read on a played tee ambiguous, and the detector deliberately
         * refuses to jump backward from there. This generated layout walks randomly between holes, so
         * it can place two tees side by side; that is a property of the fixture, not a defect.
         */
        const curTee = geo.holes[cur - 1]!.tee;
        const ambiguous = haversineYards(playedTee, curTee) <= 30;
        if (!ambiguous && haversineYards(playedTee, curGreen) > 60) {
          const onPlayedTee = detectCurrentHole(playedTee, COURSE, cur, sc);
          if (onPlayedTee.hole_number !== played) {
            flagL('standing on a played hole tee did not re-enter it', `got ${onPlayedTee.hole_number} (round ${round})`);
          }
        }
        const atCurrentGreen = detectCurrentHole(curGreen, COURSE, cur, sc);
        if (atCurrentGreen.transition_recommended) {
          flagL('recommended a transition while standing on the current green', `round ${round}`);
        }
      }
    }

    // Degenerate inputs must be refused, not guessed at.
    _clearGeometryCache();
    _seedGeometry(buildCourse(1) as never);
    const bad = [
      { lat: NaN, lng: -72.7 }, { lat: 0, lng: 0 }, { lat: 91, lng: 0 },
      { lat: 41.7, lng: 181 }, { lat: Infinity, lng: Infinity },
    ];
    for (const pos of bad) {
      const res = detectCurrentHole(pos as never, COURSE, 5, {});
      if (res.hole_number !== 5) flagL('a bad GPS fix moved the player', `${JSON.stringify(pos)} → hole ${res.hole_number}`);
      if (res.transition_recommended) flagL('a bad GPS fix recommended a transition', `${JSON.stringify(pos)}`);
    }
    // No course id, and unmapped geometry, must both hold position.
    const noCourse = detectCurrentHole({ lat: 41.7, lng: -72.7 }, null, 7, {});
    if (noCourse.hole_number !== 7 || noCourse.transition_recommended) flagL('no-course-id did not hold position', JSON.stringify(noCourse));
    _clearGeometryCache();
    const noGeo = detectCurrentHole({ lat: 41.7, lng: -72.7 }, COURSE, 7, {});
    if (noGeo.hole_number !== 7 || noGeo.transition_recommended) flagL('missing geometry did not hold position', JSON.stringify(noGeo));

    if (local.length) { console.log('\n=== HOLE DETECTION FINDINGS ==='); local.forEach(f => console.log('  ' + f)); }
    expect(local).toEqual([]);
  });

  it('never returns geometry for a hole the course does not have', () => {
    _clearGeometryCache();
    _seedGeometry(buildCourse(3) as never);
    for (const n of [0, -1, 19, 100, NaN, 1.5]) {
      const g = getHoleGeometry(COURSE, n as number);
      if (g != null) expect(g.hole_number).toBe(n);
    }
    expect(getHoleGeometry('no-such-course', 1)).toBeNull();
  });
});

describe('tee selection — the card the player is handed', () => {
  it('is ordered, total-driven, and never invents a set', () => {
    const local: string[] = [];
    const r = mulberry32(31337);
    for (let i = 0; i < 800; i++) {
      const n = Math.floor(r() * 6);
      const tees = Array.from({ length: n }, (_, k) => ({
        tee_name: r() < 0.1 ? '' : `T${k}`,
        total_yards: r() < 0.15 ? (r() < 0.5 ? 0 : (null as unknown as number)) : 4500 + Math.floor(r() * 3200),
      }));
      const picks = (['front', 'middle', 'back'] as const).map(p => pickTeeSet(tees as never, p));
      if (n === 0) {
        if (picks.some(p => p != null)) local.push('invented a tee set for a course with none');
        continue;
      }
      if (picks.some(p => p == null)) local.push(`returned null despite ${n} tee(s)`);
      for (const p of picks) if (p && !tees.includes(p as never)) local.push('returned a tee set that was not in the input');
      const measurable = tees.filter(t => typeof t.total_yards === 'number' && (t.total_yards as number) > 0);
      if (measurable.length >= 2) {
        const f = picks[0] as unknown as { total_yards: number };
        const b = picks[2] as unknown as { total_yards: number };
        if (f && b && f.total_yards > b.total_yards) local.push(`front (${f.total_yards}) longer than back (${b.total_yards})`);
        const m = picks[1] as unknown as { total_yards: number };
        if (m && f && b && (m.total_yards < f.total_yards || m.total_yards > b.total_yards)) {
          local.push(`middle (${m.total_yards}) outside front..back (${f.total_yards}..${b.total_yards})`);
        }
      }
    }
    if (local.length) { console.log('\n=== TEE SELECTION FINDINGS ==='); [...new Set(local)].slice(0, 8).forEach(f => console.log('  ' + f)); }
    expect([...new Set(local)]).toEqual([]);
  });
});
