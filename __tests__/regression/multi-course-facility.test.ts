/**
 * 2026-08-12 — one property, several courses, and the engine was building a chimera.
 *
 * Tim, on the readiness pass: resolve the Doral risk. Investigating it found a class defect, not a
 * one-course problem.
 *
 * The hole-way dedup kept the LONGEST way per hole number. That is correct for the case it was
 * written for — OSM splits one hole into segments at path crossings, all sharing ref and par — and
 * catastrophic for the case nobody handled: a multi-course facility, where TWO courses each have a
 * hole "1". Longest-wins then picks, per hole, whichever course's hole happens to be longer.
 *
 * Measured live at Trump National Doral: 41 hole-ways inside the 1500m radius and 17 of 18 hole
 * numbers with 2-3 candidates. The build "succeeded" at 18/18 and was a mixture of three courses:
 *
 *   longest-per-ref   mean walk between holes 379y, max 1030y, nine walks over 250y
 *   coherent route    mean walk  96y, max  432y, one
 *
 * A real course is a WALK — green to next tee is tens of yards — so the old build was provably not
 * one course. Our catalog has three more of these (Palms/Lakes 780m apart, Coyote Creek 1033m,
 * Gleneagles King's/Queen's sharing a centroid exactly), and the "hole 8 walks 965 yards from hole
 * 7's green" note sitting in data/courses.ts since Palms was added is this same bug, recorded
 * months ago as a suspicion.
 *
 * But coherence alone is not enough, and testing caught that: at Palms the two courses INTERLEAVE,
 * so a route can look like a perfect walk while belonging to the neighbour. Asked for Palms, the
 * coherent route landed 424y from Lakes' first tee and 1295y from Palms' own. No weighting of
 * distance-to-centroid separated them, because the courses overlap spatially.
 *
 * The scorecard does separate them, because it identifies the course rather than its shape:
 *
 *   greenhill   7.9%   berlin-cc  3.7%   doral-gold  43.5%
 *
 * Doral scores 43.5% because Golden Palm is not in OpenStreetMap at all — every candidate there
 * belongs to Blue Monster, Red Tiger or Silver Fox. So the engine now REJECTS rather than serve
 * another course's yardages to someone standing on ours.
 */
import fs from 'fs';
import path from 'path';

const read = (p: string) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const api = read('api/course-geometry.ts');
const svc = read('services/courseGeometryService.ts');

describe('the engine picks ONE course, not the longest hole from each', () => {
  it('no longer dedups hole-ways by length alone', () => {
    // THE bug, verbatim from the old code.
    expect(api).not.toContain('if (!prev || wayLen(w) > wayLen(prev)) byRef.set(w.ref, w);');
    expect(api).toContain('chooseCoherentHoleWays(holeWays, centroid, holeCount, wayLen, cardYards)');
  });

  it('still collapses OSM split segments — the case the old code got right', () => {
    // Two ways for the same ref whose endpoints nearly touch are one hole cut in half.
    expect(api).toContain('const SAME_HOLE_YD = 120;');
    expect(api).toContain('if (wayLen(w) > wayLen(bucket[twin])) bucket[twin] = w;');
  });

  it('keeps far-apart same-ref ways as rival candidates instead of discarding one', () => {
    expect(api).toContain('else bucket.push(w);');
  });

  it('scores routes by the walk between consecutive holes', () => {
    expect(api).toContain('const TRANSFER_PENALTY_YD = 600;');
    expect(api).toContain('const step = (a: OsmHoleWay, b: OsmHoleWay) => Math.min(gap(a, b), TRANSFER_PENALTY_YD);');
  });

  it('is exact rather than greedy — one wrong hole would drag the route onto the wrong course', () => {
    expect(api).toContain('prevRow = cands.map(w => {');
    expect(api).toContain('const winner = prevRow.reduce((a, b) => (b.cost < a.cost ? b : a));');
  });

  it('short-circuits when nothing is ambiguous — no behaviour change on ordinary courses', () => {
    expect(api).toContain('if (ambiguous === 0) return refs.map(r => byRef.get(r)![0]);');
  });
});

describe('the scorecard decides WHICH course, and can veto', () => {
  it('steers the choice hole by hole', () => {
    expect(api).toContain('const cardErr = (w: OsmHoleWay): number => {');
    expect(api).toContain('+ cardErr(w)');
  });

  it('rejects a route that matches no better than a neighbouring course would', () => {
    expect(api).toContain('if (meanErr > 0.25) {');
    expect(api).toContain('these belong to another course on this property');
    expect(api).toContain('return [];');
  });

  it('only vetoes when there is a card to check against', () => {
    // Absence of a scorecard is not evidence of a mismatch.
    expect(api).toContain('if (checkable.length >= 3) {');
  });

  it('uses the same 25% bar as the bundled-geometry trust gate', () => {
    // Honest tee-marker and green-centre variance runs under 10% on a correct match
    // (greenhill 7.9%, berlin 3.7%); 25% only fires on a genuinely different course.
    expect(read('services/courseGeometryService.ts')).toContain('return mean <= 0.25;');
    expect(api).toContain('meanErr > 0.25');
  });

  it('the client actually sends the card — otherwise the whole gate is dead code', () => {
    expect(svc).toContain("params.set('cardYards'");
    expect(svc).toContain('const card = getBundledHoles(courseId);');
    // Scorecard-only courses have 0/0 coords but REAL yardages — the case that needs this most.
    expect(svc).toContain('h.distance > 50 ? h.distance : 0');
  });

  it('the server parses it defensively', () => {
    expect(api).toContain("String(req.query.cardYards ?? '')");
    expect(api).toContain('.slice(0, 18)');
  });
});

describe('courses that could only ever ask OpenStreetMap', () => {
  it('Doral now has an upstream hint — the commercial API lists Golden Palm by name', () => {
    // Tim: "isn't Doral one of the most famous courses right now?" It is; we simply never asked the
    // source that has it. With no hint, resolveLocalCourseId returned null and the engine fell
    // straight to OSM-only, where Golden Palm's holes do not exist.
    expect(svc).toContain("'doral-gold': { search: 'Trump National Doral Golden Palm'");
  });

  it('the other scorecard-only courses got hints too', () => {
    for (const slug of ['shadow-lakes', 'webster-dudley', 'legacy-springfield']) {
      expect(svc).toContain(`'${slug}': { search:`);
    }
  });

  it('Rancho California no longer searches the wrong town', () => {
    // Its centroid was 7.96km out for the same reason: the course is in Murrieta, not Temecula.
    expect(svc).toContain("expectedCity: 'murrieta'");
    expect(svc).not.toContain("{ search: 'Rancho California Golf Club', expectedCity: 'temecula' }");
  });
});
