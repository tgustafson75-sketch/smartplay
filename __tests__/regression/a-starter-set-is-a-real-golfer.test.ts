/**
 * 2026-09-11 — TWO BUGS THAT ONLY A STARTER SET COULD SHOW.
 *
 * The 100-player market sim ran clean, so the population was audited rather than trusted. Handicap
 * 8-26 with each club present 85% of the time gives every one of 500 personas a bag of about twelve
 * clubs. The engines had never seen a starter set, a borrowed half set, a 36-handicap or a scratch
 * player — all real people who will download this, and all outside every number the engines had ever
 * been run against.
 *
 * Widening the population surfaced two immediately, and neither is subtle once you see it:
 *
 *   "Driver + Sand Wedge + 7 Iron" on a par 4. Arithmetically perfect, and nobody has ever played
 *   golf that way — you hit the 7 iron and then the wedge.
 *
 *   "3 Iron" recommended to a player whose bag is a driver, a 7 iron and a sand wedge. The standard
 *   ladder is merged in deliberately, so a sparse bag cannot collapse it and produce "gap wedge for
 *   324 yards" — but that merge also made chart rungs eligible as RECOMMENDATIONS.
 */
import { composeShotRead } from '../../services/cnsShotRead';
import { planHole } from '../../services/holePlan';

/** A real starter set: driver, one iron, one wedge. */
const STARTER = { Driver: 190, '7 Iron': 120, 'Sand Wedge': 70 };
const OWNED = ['Driver', '7 Iron', 'Sand Wedge'];

describe('a lay-up goes longest first', () => {
  it('does not play a wedge and then an iron into the green', () => {
    const plan = planHole({ par: 4, holeYards: 370, bag: STARTER })!;
    expect(plan).not.toBeNull();
    const carries = plan.steps.map((s) => s.carryYards);
    for (let i = 1; i < carries.length; i++) {
      expect(carries[i]).toBeLessThanOrEqual(carries[i - 1]);
    }
  });

  it('holds across every hole a course has, and every set shape', () => {
    for (const bag of [STARTER, { Driver: 220, '3W': 200, '5I': 160, '7I': 140, '9I': 118, PW: 105, SW: 78 }]) {
      for (const [par, yards] of [[3, 165], [4, 310], [4, 370], [4, 455], [5, 520], [5, 610]] as [number, number][]) {
        const plan = planHole({ par, holeYards: yards, bag });
        if (!plan) continue;
        const carries = plan.steps.map((s) => s.carryYards);
        for (let i = 1; i < carries.length; i++) {
          expect(carries[i]).toBeLessThanOrEqual(carries[i - 1]);
        }
      }
    }
  });

  it('and still reaches the green it says it reaches', () => {
    const plan = planHole({ par: 4, holeYards: 370, bag: STARTER })!;
    expect(plan.steps.reduce((a, s) => a + s.carryYards, 0)).toBeGreaterThanOrEqual(370);
    expect(plan.steps[plan.steps.length - 1].leavesYards).toBe(0);
  });
});

describe('it never names a club he does not own', () => {
  it.each([312, 205, 158, 96, 41])('at %sy', (yards) => {
    const read = composeShotRead({
      rawYards: yards, weather: null, shotBearingDeg: null, bag: STARTER, ownedLabels: OWNED,
    })!;
    expect(OWNED).toContain(read.club);
  });

  it('without a registered bag the ladder still stands — empty means UNKNOWN', () => {
    /**
     * A player who has not scanned or entered a bag must not be treated as owning nothing.
     *
     * TWO independent guards enforce this and break-testing showed it: removing the empty-set check
     * still passes, because the "would leave fewer than two clubs to choose from" fallback catches
     * it as well. This asserts the PROPERTY rather than either guard, which is the right bar — but
     * it is worth saying that it is belt and braces, not one line.
     */
    const read = composeShotRead({ rawYards: 205, weather: null, shotBearingDeg: null, bag: STARTER })!;
    expect(read.club).toBeTruthy();
    const withEmpty = composeShotRead({
      rawYards: 205, weather: null, shotBearingDeg: null, bag: STARTER, ownedLabels: [],
    })!;
    expect(withEmpty.club).toBe(read.club);
  });

  it('and a filter that would leave nothing to choose from is ignored', () => {
    // Narrowing the ladder to empty would be worse than naming a chart club.
    const read = composeShotRead({
      rawYards: 158, weather: null, shotBearingDeg: null, bag: STARTER, ownedLabels: ['Nonexistent Club'],
    })!;
    expect(read.club).toBeTruthy();
  });

  it('the live composer supplies the registered bag, translated to ladder labels', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const live = fs.readFileSync(path.resolve(__dirname, '../../services/shotReadLive.ts'), 'utf8');
    expect(live).toMatch(/ownedLabels: safe\(/);
    expect(live).toMatch(/clubIdToClubName\(c\.club_id\)/);
    expect(live).toMatch(/CLUB_LABEL as Record<string, string>\)\[canon\]/);
  });
});
