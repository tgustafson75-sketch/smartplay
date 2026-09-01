/**
 * 2026-09-01 (Tim, from the field at Menifee Lakes: "Menifee Lakes lakes showing as shadow lakes",
 * and "all other Menifee Lakes listing only pull up Palms").
 *
 * FOUR bundled courses contain the word "Lakes": Shadow Lakes, Pembroke Lakes, Menifee Lakes Palms
 * and Menifee Lakes Lakes. Two separate resolvers picked between them by substring, and both picked
 * wrong — in opposite directions.
 */
import { getCourse, COURSES } from '../../data/courses';
import { getLocalCourseSlug } from '../../data/localCourseImages';

describe('an exact id beats a substring name', () => {
  it("THE REPORT: getCourse('lakes') is Menifee's Lakes, not Shadow Lakes", () => {
    // simRound does getCourse(courseId.replace(/^local:/,'')), so a round at Menifee asks for
    // exactly this. Shadow Lakes is declared EARLIER in the array and used to win on first-match.
    expect(getCourse('lakes')?.id).toBe('lakes');
    expect(getCourse('lakes')?.name).toBe('Menifee Lakes Lakes');
  });

  it('Shadow Lakes really is declared first — the ordering the old code depended on', () => {
    const shadow = COURSES.findIndex((c) => c.id === 'shadow-lakes');
    const menifee = COURSES.findIndex((c) => c.id === 'lakes');
    expect(shadow).toBeGreaterThan(-1);
    expect(menifee).toBeGreaterThan(shadow); // if this flips, the bug hid itself rather than being fixed
  });

  it('every bundled course resolves to ITSELF by its own id', () => {
    // The class guard: no course may be reachable only by accident of array order.
    const wrong = COURSES.filter((c) => getCourse(c.id)?.id !== c.id).map((c) => c.id);
    expect(wrong).toEqual([]);
  });

  it('an exact name still resolves, and still beats a substring', () => {
    expect(getCourse('Shadow Lakes')?.id).toBe('shadow-lakes');
    expect(getCourse('Menifee Lakes Lakes')?.id).toBe('lakes');
    expect(getCourse('Pembroke Lakes')?.id).toBe('pembroke-pines');
  });

  it('a substring lookup still works for callers that pass a partial name', () => {
    expect(getCourse('Pembroke')?.id).toBe('pembroke-pines');
  });

  it('an empty or whitespace query never matches the first course in the array', () => {
    expect(getCourse('')).toBeNull();
    expect(getCourse('   ')).toBeNull();
  });
});

describe('the slug resolver keeps the Lakes courses apart', () => {
  it('Shadow Lakes does NOT resolve to Menifee', () => {
    // It had no rule at all and fell through to the bare `lakes` match, so Jay's home course
    // rendered Menifee's centroid, aerials and hole geometry.
    expect(getLocalCourseSlug('Shadow Lakes')).toBe('shadow-lakes');
    expect(getLocalCourseSlug('Shadow Lakes Golf Club')).toBe('shadow-lakes');
    expect(getLocalCourseSlug('Shadow Lakes G.C., Brentwood CA')).toBe('shadow-lakes');
  });

  it('the Menifee pair still resolve to themselves', () => {
    expect(getLocalCourseSlug('Menifee Lakes Lakes')).toBe('lakes');
    expect(getLocalCourseSlug('Menifee Lakes — Palms')).toBe('palms');
    expect(getLocalCourseSlug('Menifee Lakes Country Club')).toBe('lakes');
  });

  it('Pembroke keeps its own precedence', () => {
    expect(getLocalCourseSlug('Pembroke Lakes')).toBe('pembroke-pines');
  });

  it('no bundled "Lakes" course collides with another', () => {
    const names = ['Shadow Lakes', 'Pembroke Lakes', 'Menifee Lakes Lakes', 'Menifee Lakes Palms'];
    const slugs = names.map((n) => getLocalCourseSlug(n));
    expect(new Set(slugs).size).toBe(names.length); // all distinct
    expect(slugs).not.toContain(null);
  });
});
