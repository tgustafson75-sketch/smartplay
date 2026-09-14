/**
 * 2026-09-13 (Tim: "Finish all no device test items") — A CONFIDENTLY WRONG HANDICAP NUMBER.
 *
 * Found auditing `services/intents/handicapQueryHandler`, one of three intent handlers my own
 * unguarded-surface inventory flagged as worth doing first: every one of them is a thing a player can
 * SAY, so an untested handler is an untested sentence out of the caddie's mouth.
 *
 * `strokesReceivedOnHole(courseHandicap, holeStrokeIndex)` allocates by the scorecard's HCP column —
 * 1 = hardest … 18 = easiest — and the handler called it with `round.currentHole`. Those are different
 * numbers: hole 1 might be stroke index 7. So off a Course Handicap of 7 the caddie granted a stroke on
 * hole 1 that the player does not get, withheld one on the hole where they do, and said it as fact:
 * "Your max for handicap is 7 (par 4 plus 2 plus 1 stroke)."
 *
 * THE DATA WAS THERE THE WHOLE TIME. golfcourseapi returns the column, and `normalizeHole` has always
 * captured it (`handicap: raw.handicap ?? raw.handicap_index`). The mapping into `CourseHole` one step
 * later dropped it — normalized at the boundary, discarded immediately after. That is why the handler
 * had nothing better to reach for.
 *
 * Where it is genuinely absent (the bundled catalog, a partially-populated course) the answer is now
 * the par+2 floor plus an explicit "I don't have this scorecard's handicap column", because inventing a
 * stroke allocation from the hole number is exactly the kind of confident sentence this app keeps
 * having to take back. [[smartplay-defect-class-unwired-halves]]
 */
import fs from 'fs';
import path from 'path';
import { strokesReceivedOnHole, netDoubleBogeyCap } from '../../services/handicapCalculator';

const root = path.resolve(__dirname, '../..');
const code = (rel: string) =>
  fs.readFileSync(path.join(root, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(?<![:\w])\/\/[^\n]*/g, ' ');

describe('the WHS allocation is keyed on the stroke index', () => {
  it('a stroke index and a hole number give DIFFERENT answers — which is the whole bug', () => {
    // Course Handicap 7 → strokes on the seven hardest holes (index 1..7).
    expect(strokesReceivedOnHole(7, 7)).toBe(1);   // seventh-hardest hole: gets a stroke
    expect(strokesReceivedOnHole(7, 8)).toBe(0);   // eighth-hardest: does not
    // So passing hole number 1 for a hole whose index is 8 invents a stroke:
    expect(strokesReceivedOnHole(7, 1)).toBe(1);
    expect(strokesReceivedOnHole(7, 1)).not.toBe(strokesReceivedOnHole(7, 8));
  });

  it('a plus/scratch handicap receives nothing anywhere', () => {
    for (const si of [1, 9, 18]) expect(strokesReceivedOnHole(0, si)).toBe(0);
    expect(strokesReceivedOnHole(-2, 1)).toBe(0);
  });

  it('a handicap above 18 gives a second stroke on the hardest holes', () => {
    expect(strokesReceivedOnHole(22, 4)).toBe(2);
    expect(strokesReceivedOnHole(22, 5)).toBe(1);
  });

  it('the net double bogey cap is par + 2 + strokes', () => {
    expect(netDoubleBogeyCap(4, 0)).toBe(6);
    expect(netDoubleBogeyCap(4, 1)).toBe(7);
    expect(netDoubleBogeyCap(3, 2)).toBe(7);
  });
});

describe('the handler reads the real index, or admits it has none', () => {
  const h = code('services/intents/handicapQueryHandler.ts');

  it('it no longer passes the hole number as a stroke index', () => {
    expect(h).not.toMatch(/strokesReceivedOnHole\(ch, round\.currentHole/);
    expect(h).toMatch(/strokesReceivedOnHole\(ch, strokeIndex\)/);
  });

  it('it resolves the hole through the ONE owner, not an inline find', () => {
    /**
     * `one-truth-per-fact` pins this: ~20 call sites used to do `courseHoles.find(h => h.hole === n)`
     * themselves, which skips the bundled fallback, so before courseHoles hydrates they read undefined
     * and defaulted par to 4 — a par 3 briefed and posted as a par 4. My first version of this fix
     * used exactly that inline lookup and failed that guard, which is the guard doing its job on me.
     */
    expect(h).toMatch(/resolvedHoleData\(round\.currentHole \|\| 1\)/);
    expect(h).not.toMatch(/round\.courseHoles\.find\(/);
    expect(h).toMatch(/holeRecord\?\.strokeIndex/);
  });

  it('a zero or missing index counts as UNKNOWN, not as index zero', () => {
    // strokesReceivedOnHole(h, 0) would grant a stroke to every positive handicap, silently.
    expect(h).toMatch(/holeRecord\.strokeIndex > 0/);
  });

  it('with no index it states the par+2 floor and says what it cannot work out', () => {
    expect(h).toMatch(/handicap:ndb:no_stroke_index/);
    expect(h).toMatch(/don.{0,3}t have this scorecard.{0,3}s handicap column/);
  });

  it('and it does not pretend a stroke is impossible when the handicap allows one', () => {
    // The honest no-index answer must still say a stroke MAY apply — "at least N" — rather than
    // reporting the floor as the answer.
    expect(h).toMatch(/at least \$\{floor\}/);
  });
});

describe('the column survives the trip from the API to the hole record', () => {
  it('normalizeHole still captures it', () => {
    expect(code('services/golfCourseApi.ts')).toMatch(/handicap: raw\.handicap \?\? raw\.handicap_index \?\? null/);
  });

  it('and the CourseHole mapping no longer drops it', () => {
    expect(code('services/golfCourseApi.ts')).toMatch(/strokeIndex: h\.handicap \?\? null/);
  });

  it('CourseHole declares it as optional-and-nullable, so UNKNOWN is representable', () => {
    expect(code('store/roundStore.ts')).toMatch(/strokeIndex\?: number \| null;/);
  });
});

describe('the two handicap fields cannot drift apart', () => {
  it('both setters write both fields — checked, because the handler reads only one', () => {
    /**
     * handicapQueryHandler reads `handicap_index` and answers "I don't have your Index yet" when it is
     * null. That would be wrong if anything could set `handicap` alone. Nothing can: both setters write
     * the pair. Asserted rather than assumed, because the failure would be the caddie denying a number
     * the Settings screen is displaying.
     */
    const store = code('store/playerProfileStore.ts');
    expect(store).toMatch(/setHandicap: \(hcp\) => set\(\{ handicap: hcp, handicap_index: hcp \}\)/);
    expect(store).toMatch(/return \{ handicap_index: idx, handicap: rounded \};/);
  });
});
