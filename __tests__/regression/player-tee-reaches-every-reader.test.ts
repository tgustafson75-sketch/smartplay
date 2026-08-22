import { courseToHoles, courseSummaryForContext } from '../../services/golfCourseApi';
import { usePlayerProfileStore } from '../../store/playerProfileStore';
import type { Course } from '../../types/course';

/**
 * 2026-08-22 — from building Sharp Park (Pacifica) through the real user path.
 *
 * `courseToHoles(course, teeName?)` grew a careful tee-name lookup on 08-19 and ALL FOUR callers
 * passed nothing, so every one fell through to `course.tees[0]`: the longest set on the card, in the
 * women's rating copy. A Gold-tee player was quoted the Blue card everywhere — 6416 yards instead of
 * 5087, hole 5 at 195 when they were hitting 125 — and the caddie recommended clubs off it.
 *
 * The numbers below are Sharp Park's real card, kept offline so this holds without the network.
 */
const holesFor = (yards: number[], pars: number[]) =>
  yards.map((y, i) => ({ hole_number: i + 1, par: pars[i], yardage: y, handicap: i + 1, hazards: [] as string[] }));

const PARS = [4,4,4,5,3,4,4,3,5,4,4,3,5,4,3,4,4,5];
const BLUE = [366,335,367,458,195,419,402,89,479,411,410,207,544,391,145,354,348,496];
const GOLD = [282,235,321,390,125,325,330,91,385,335,326,130,430,310,116,268,271,417];

const SHARP_PARK = {
  id: '0s3cpq35',
  club_name: 'Sharp Park Gc',
  course_name: 'Sharp Park Gc',
  location: { city: 'Pacifica', state: 'CA' },
  tees: [
    // Deliberately in the API's own order: the women's set comes FIRST, which is what made
    // `tees[0]` quietly wrong for everyone.
    { tee_name: 'Blue', total_yards: 6416, course_rating: 77.5, slope_rating: 135, par_total: 72, gender: 'female', holes: holesFor(BLUE, PARS) },
    { tee_name: 'Gold', total_yards: 5087, course_rating: 69.8, slope_rating: 120, par_total: 72, gender: 'female', holes: holesFor(GOLD, PARS) },
    { tee_name: 'Blue', total_yards: 6416, course_rating: 71.2, slope_rating: 125, par_total: 72, gender: 'male', holes: holesFor(BLUE, PARS) },
    { tee_name: 'Gold', total_yards: 5087, course_rating: 65.1, slope_rating: 112, par_total: 72, gender: 'male', holes: holesFor(GOLD, PARS) },
  ],
} as unknown as Course;

const totalOf = (c: Course) => courseToHoles(c).reduce((a, h) => a + (h.distance || 0), 0);
const hole5 = (c: Course) => courseToHoles(c).find(h => h.hole === 5)?.distance;
const ratingOf = (c: Course) => courseSummaryForContext(c).match(/rating ([\d.]+)/)?.[1];

describe('the player’s tee reaches every reader, not just the settings screen', () => {
  const set = (tee: 'front' | 'middle' | 'back', g: 'm' | 'f' | 'x') => {
    const st = usePlayerProfileStore.getState();
    st.setPreferredTee(tee);
    st.setHandicapGender(g);
  };

  it('quotes the front-tee player the FRONT card', () => {
    set('front', 'm');
    expect(totalOf(SHARP_PARK)).toBe(5087);
    expect(hole5(SHARP_PARK)).toBe(125);
  });

  it('quotes the back-tee player the BACK card', () => {
    set('back', 'm');
    expect(totalOf(SHARP_PARK)).toBe(6416);
    expect(hole5(SHARP_PARK)).toBe(195);
  });

  it('a 70-yard hole-5 gap does not depend on which set the API happened to list first', () => {
    set('front', 'm'); const front = hole5(SHARP_PARK)!;
    set('back', 'm');  const back = hole5(SHARP_PARK)!;
    expect(back - front).toBe(70);
  });

  it('briefs the caddie with the player’s OWN rating, not the first one on the card', () => {
    set('back', 'm');
    expect(ratingOf(SHARP_PARK)).toBe('71.2');
    set('back', 'f');
    expect(ratingOf(SHARP_PARK)).toBe('77.5');
  });

  it('names the tee it actually used', () => {
    set('front', 'm');
    expect(courseSummaryForContext(SHARP_PARK)).toContain('Gold tee');
    set('back', 'm');
    expect(courseSummaryForContext(SHARP_PARK)).toContain('Blue tee');
  });

  it('an explicit tee name still wins over the profile', () => {
    set('front', 'm');
    expect(courseToHoles(SHARP_PARK, 'Blue').reduce((a, h) => a + (h.distance || 0), 0)).toBe(6416);
  });

  it('still works for a course with a single ungendered tee set', () => {
    set('back', 'x');
    const simple = { ...SHARP_PARK, tees: [SHARP_PARK.tees[2]] } as Course;
    expect(courseToHoles(simple).length).toBe(18);
    expect(ratingOf(simple)).toBe('71.2');
  });
});
