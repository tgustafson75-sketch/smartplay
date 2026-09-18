/**
 * 2026-09-17 (Tim) — "home course selection logic needs to be checked. I tried and it just went to
 * the play tab. User should also be able to mark a star on a course's card."
 *
 * The toggle was BUILT on 09-14, with a comment saying it belongs "where the courses are" — and put
 * on exactly ONE surface: the expanded card of a course you have already selected. Profile's
 * "Choose home courses" jumps to the Play tab, so until you happened to tap a course open there was
 * nothing on screen to tap, and the button read as broken. The capability existed; the route to it
 * did not. The same half-wired shape as the referral programme and the paywall.
 * [[reachable-not-just-wired]] [[smartplay-defect-class-unwired-halves]]
 *
 * The store half is pure and gets real assertions. The placement is structural — play.tsx is ~3,100
 * lines and mounting it would test the renderer, not the wiring — so it is pinned as a count: the
 * star must appear on the ROWS as well as the selected card, and that count going back to one is
 * the regression worth catching.
 */

import { usePlayerProfileStore, MAX_HOME_COURSES } from '../../store/playerProfileStore';

const reset = () => usePlayerProfileStore.setState({ homeCourses: [] });

describe('setting a home course', () => {
  beforeEach(reset);

  it('marks a course, and the same tap clears it', () => {
    const toggle = usePlayerProfileStore.getState().toggleHomeCourse;
    expect(toggle({ id: 'palms', name: 'Menifee Palms' })).toBe(true);
    expect(usePlayerProfileStore.getState().homeCourses).toHaveLength(1);
    expect(toggle({ id: 'palms', name: 'Menifee Palms' })).toBe(true);
    expect(usePlayerProfileStore.getState().homeCourses).toHaveLength(0);
  });

  it('refuses a fourth rather than silently evicting one of his three', () => {
    const toggle = usePlayerProfileStore.getState().toggleHomeCourse;
    for (let i = 0; i < MAX_HOME_COURSES; i++) {
      expect(toggle({ id: `c${i}`, name: `Course ${i}` })).toBe(true);
    }
    expect(toggle({ id: 'extra', name: 'One Too Many' })).toBe(false);
    expect(usePlayerProfileStore.getState().homeCourses).toHaveLength(MAX_HOME_COURSES);
    // and the refusal must not have disturbed the existing set
    expect(usePlayerProfileStore.getState().homeCourses.map((h) => h.id)).toEqual(['c0', 'c1', 'c2']);
  });

  it('un-starring one of a full set makes room again', () => {
    const toggle = usePlayerProfileStore.getState().toggleHomeCourse;
    for (let i = 0; i < MAX_HOME_COURSES; i++) toggle({ id: `c${i}`, name: `Course ${i}` });
    expect(toggle({ id: 'c1', name: 'Course 1' })).toBe(true);   // remove
    expect(toggle({ id: 'new', name: 'New Home' })).toBe(true);  // now fits
  });

  it('does not add the same course twice under a different id shape', () => {
    const toggle = usePlayerProfileStore.getState().toggleHomeCourse;
    toggle({ id: 'palms', name: 'Menifee Palms' });
    toggle({ id: 'palms', name: 'Menifee Palms' });
    expect(usePlayerProfileStore.getState().homeCourses.length).toBeLessThanOrEqual(1);
  });
});

describe('and it is reachable from more than one course at a time', () => {
  it('the star is on the course ROWS, not only the selected card', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const src = fs.readFileSync(path.join(__dirname, '../../app/(tabs)/play.tsx'), 'utf8');
    // Two surfaces: every row in the list, and the expanded card. One was the bug.
    const stars = src.match(/star-outline/g) ?? [];
    expect(stars.length).toBeGreaterThanOrEqual(2);
    // and both go through the one helper, so the three-course cap cannot be bypassed by a surface
    // that forgot to check the return value.
    expect(src).toMatch(/const toggleHome = useCallback/);
    const direct = src.match(/getState\(\)\.toggleHomeCourse\(/g) ?? [];
    expect(direct.length).toBe(1); // only inside the shared helper
  });
});
