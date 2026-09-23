/**
 * 2026-09-23 (Tim) — the Play tab pre-loads the three nearest courses the player has NOT picked. It
 * ran the full chain for each: golfcourseapi search + detail, geometry, AND two paid Claude calls
 * (course-content, and course-intelligence with web search). The speculative build keeps the map and
 * offline data; the paid half waits until a course is actually picked.
 */
jest.mock('../../services/connectionClass', () => ({ mayPullCourseNow: async () => ({ ok: true }) }));
jest.mock('../../services/courseContentService', () => ({ fetchCourseContent: jest.fn(async () => null) }));
jest.mock('../../services/courseIntelligenceService', () => ({ fetchCourseIntelligence: jest.fn(async () => ({ intelligence: null, source: 'error', cached_at: 0 })) }));
jest.mock('../../services/courseGeometryService', () => ({
  fetchCourseGeometry: jest.fn(async () => null),
  loadDerivedGeometry: jest.fn(async () => undefined),
  mappedHoleCount: () => 0,
  getHoleGeometry: () => null,
}));
jest.mock('../../services/golfCourseApi', () => {
  const actual = jest.requireActual('../../services/golfCourseApi');
  return {
    ...actual,
    searchCourses: jest.fn(async () => [{ id: 'nearA', club_name: 'Near A', course_name: 'Near A', location: '' }]),
    getCourse: jest.fn(async (id: string) => ({
      id, club_name: 'Near A', course_name: 'Near A',
      location: { city: '', state: '', country: 'US', latitude: 33.7, longitude: -117.1 },
      tees: [{ tee_name: 'W', course_rating: 70, slope_rating: 120, total_yards: 6000, par_total: 72,
        holes: Array.from({ length: 18 }, (_, i) => ({ hole_number: i + 1, par: 4, yardage: 350, handicap: i + 1 })) }],
      cached_at: Date.now(),
    })),
  };
});

import { prefetchFoundCourses, _resetDownloadEngineForTests } from '../../services/courseDownloadEngine';
import { prefetchRoundData } from '../../services/roundPrefetch';
import { fetchCourseContent } from '../../services/courseContentService';
import { fetchCourseIntelligence } from '../../services/courseIntelligenceService';
import { useDownloadedCoursesStore } from '../../store/downloadedCoursesStore';

describe('nearby pre-load: map and offline data, no paid content', () => {
  beforeEach(() => {
    _resetDownloadEngineForTests();
    (fetchCourseContent as jest.Mock).mockClear();
    (fetchCourseIntelligence as jest.Mock).mockClear();
    useDownloadedCoursesStore.setState({ downloaded: {} } as never);
  });

  it('three courses nobody picked cost zero Claude calls', async () => {
    await prefetchFoundCourses([
      { name: 'Near A', place_id: 'pa', lat: 33.7, lng: -117.1 },
    ] as never, 3);
    expect(fetchCourseContent).not.toHaveBeenCalled();
    expect(fetchCourseIntelligence).not.toHaveBeenCalled();
  });

  it('a deliberate build (round start, home course) still gets the full chain', async () => {
    await prefetchRoundData({ courseId: 'picked', courseName: 'Picked', holes: [{ hole: 1, par: 4, distance: 350 }] as never });
    expect(fetchCourseContent).toHaveBeenCalledTimes(1);
    expect(fetchCourseIntelligence).toHaveBeenCalledTimes(1);
  });
});
