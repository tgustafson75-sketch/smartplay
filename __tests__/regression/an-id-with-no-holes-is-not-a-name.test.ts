/**
 * 2026-09-23 (triple-check) — asked to download a database id whose record has no tees, the engine
 * fell through to a NAME search and downloaded whatever came first: Bethpage Black (no tees) came
 * back as Bethpage Yellow, marked owned and listed in the Play tab. An id is the course asked for.
 */
jest.mock('../../services/roundPrefetch', () => ({ prefetchRoundData: jest.fn(async () => 18) }));
jest.mock('../../services/golfCourseApi', () => {
  const actual = jest.requireActual('../../services/golfCourseApi');
  const rec = (id: string, withTees: boolean) => ({
    id, club_name: 'Bethpage State Park', course_name: id,
    location: { city: '', state: 'NY', country: 'US', latitude: 40.74, longitude: -73.45 },
    tees: withTees ? [{ tee_name: 'W', course_rating: 70, slope_rating: 120, total_yards: 6000, par_total: 71,
      holes: Array.from({ length: 18 }, (_, i) => ({ hole_number: i + 1, par: 4, yardage: 350, handicap: i + 1 })) }] : [],
    cached_at: 0,
  });
  return {
    ...actual,
    getCourse: jest.fn(async (id: string) => (id === 'black' ? rec('black', false) : id === 'yellow' ? rec('yellow', true) : null)),
    peekCachedCourse: jest.fn(async () => null),
    searchCourses: jest.fn(async () => [{ id: 'yellow', club_name: 'Bethpage State Park', course_name: 'Yellow', location: '' }]),
  };
});

import { downloadCourse } from '../../services/courseDownloadEngine';
import { useDownloadedCoursesStore } from '../../store/downloadedCoursesStore';

it('a database id whose record has no holes is not downloaded as some other course by name', async () => {
  const r = await downloadCourse({ name: 'Bethpage State Park', courseId: 'black' });
  expect(r.courseId).not.toBe('yellow');
  expect(useDownloadedCoursesStore.getState().downloaded.yellow).toBeUndefined();
});
