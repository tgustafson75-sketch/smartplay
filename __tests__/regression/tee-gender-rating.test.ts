/**
 * The course rating must belong to the player it is applied to.
 *
 * 2026-08-21. Found by building Sharp Park (Pacifica, CA) end to end through the real user path —
 * search, select, load, derive holes — exactly as a player would.
 *
 * The holes came out perfect: 18, par 72, 6416 yards, no gaps. What was wrong sat one layer down.
 * golfcourseapi returns male and female tee sets SEPARATELY and they share yardages:
 *
 *     Blue  6416y — 77.5/135 (women's)  AND  71.2/125 (men's)
 *     White 6165y — 76.1/132            AND  70.0/124
 *
 * extractTees flattened both groups into one list and discarded the gender key, so a men's Blue and
 * a women's Blue became indistinguishable. pickTeeSet orders by yardage alone, identical yardages
 * TIE, and the tie resolved to whichever the API listed first — the women's set.
 *
 * Course handicap is (Index × Slope/113) + (Rating − Par). A man playing the Blues at Sharp Park was
 * being handed a handicap computed off 77.5/135 instead of 71.2/125: wrong net scores, wrong
 * posting, and nothing on screen to suggest it.
 */
import { pickTeeSet } from '../../services/teeSelection';

/** Sharp Park as the API actually returns it — female group first, identical yardages. */
const SHARP_PARK = [
  { tee_name: 'Blue',  total_yards: 6416, course_rating: 77.5, slope_rating: 135, gender: 'female' as const },
  { tee_name: 'WHITE', total_yards: 6165, course_rating: 76.1, slope_rating: 132, gender: 'female' as const },
  { tee_name: 'RED',   total_yards: 5608, course_rating: 72.7, slope_rating: 125, gender: 'female' as const },
  { tee_name: 'Blue',  total_yards: 6416, course_rating: 71.2, slope_rating: 125, gender: 'male' as const },
  { tee_name: 'White', total_yards: 6165, course_rating: 70.0, slope_rating: 124, gender: 'male' as const },
  { tee_name: 'Red',   total_yards: 5608, course_rating: 67.6, slope_rating: 116, gender: 'male' as const },
];

describe('a player gets their own rating', () => {
  it('a man off the back tees gets the MEN\'S rating, not the women\'s', () => {
    const t = pickTeeSet(SHARP_PARK, 'back', 'm')!;
    expect(t.total_yards).toBe(6416);
    expect(t.course_rating).toBe(71.2);   // was 77.5 — a whole different course handicap
    expect(t.slope_rating).toBe(125);
  });

  it('a woman off the back tees gets the WOMEN\'S rating', () => {
    const t = pickTeeSet(SHARP_PARK, 'back', 'f')!;
    expect(t.total_yards).toBe(6416);
    expect(t.course_rating).toBe(77.5);
  });

  it('yardage still decides LENGTH — gender only decides whose rating', () => {
    expect(pickTeeSet(SHARP_PARK, 'front', 'm')!.total_yards).toBe(5608);
    expect(pickTeeSet(SHARP_PARK, 'back', 'm')!.total_yards).toBe(6416);
  });
});

describe('unknown gender does not guess', () => {
  it('collapses to ONE consistent set rather than interleaving two scorecards', () => {
    // Mixing two rating sets is what caused the bug. With no gender we dedupe by yardage so the
    // ratings stay internally consistent, and front/middle/back keep meaning what they say.
    const t = pickTeeSet(SHARP_PARK, 'back', 'x')!;
    expect(t.total_yards).toBe(6416);
    const mid = pickTeeSet(SHARP_PARK, 'middle', 'x')!;
    expect([6165, 5608]).toContain(mid.total_yards);
  });

  it('still works on ungendered data — most courses have one set', () => {
    const plain = [
      { tee_name: 'Back', total_yards: 6800, course_rating: 72.1, slope_rating: 130 },
      { tee_name: 'Mid',  total_yards: 6300, course_rating: 70.0, slope_rating: 124 },
      { tee_name: 'Fwd',  total_yards: 5400, course_rating: 66.2, slope_rating: 112 },
    ];
    expect(pickTeeSet(plain, 'back')!.total_yards).toBe(6800);
    expect(pickTeeSet(plain, 'front')!.total_yards).toBe(5400);
  });
});
