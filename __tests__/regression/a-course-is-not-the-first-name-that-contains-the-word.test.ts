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
  });

  it('...but the PARENT CLUB name resolves to neither — corrected 2026-09-05', () => {
    /**
     * THIS ASSERTION USED TO READ `.toBe('lakes')`, AND THAT IS THE BUG TIM HIT ON THE COURSE.
     *
     * On 2026-09-01 this file locked in "Menifee Lakes Country Club" meaning the Lakes layout. It
     * looked harmless — the club is named after the Lakes — and it made a real symptom go away.
     *
     * On 2026-09-05 Tim played the PALMS. golfcourseapi returns the same `club_name` for both
     * layouts, the round was stamped with that club name alone, and this rule then answered "lakes"
     * with total confidence. He got the Lakes' hole photographs beside correct Palms yardages, on
     * his home course, on a build that was already in review.
     *
     * A facility name cannot identify a layout. The previous expectation was not a smaller bug than
     * the one it fixed; it was the same bug pointed the other way. The real fix is upstream — the
     * round now carries "Menifee Lakes Country Club — Palms" — and this resolver declines rather
     * than guessing when the layout is genuinely absent.
     */
    expect(getLocalCourseSlug('Menifee Lakes Country Club')).toBeNull();
    expect(getLocalCourseSlug('Menifee Lakes')).toBeNull();

    // ...and with the layout present, both siblings resolve exactly.
    expect(getLocalCourseSlug('Menifee Lakes Country Club — Palms')).toBe('palms');
    expect(getLocalCourseSlug('Menifee Lakes Country Club — Lakes')).toBe('lakes');
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
