/**
 * 2026-09-23 (Tim) — "It just feels somewhat like we haven't fixed the universal truth around course
 * building." Seven surfaces each ran their own search/detail/geometry/content for one course. The
 * download engine is now the ONE pipeline; these pin what that means behaviourally:
 *
 *  - it publishes live stages (card → map → imagery) onto the id the tapped card holds, and clears
 *    them when the course lands in Your courses with its real green count;
 *  - READY means playable (map + imagery): a paid generation that never returns cannot hold a course
 *    at "building";
 *  - a build that ends without a course says why on the card instead of silently vanishing.
 */
const stagesSeen: string[] = [];
let contentNeverReturns = false;
jest.mock('../../services/courseContentService', () => ({
  fetchCourseContent: jest.fn(() => (contentNeverReturns ? new Promise(() => undefined) : Promise.resolve(null))),
}));
jest.mock('../../services/courseIntelligenceService', () => ({
  fetchCourseIntelligence: jest.fn(async () => ({ intelligence: null, source: 'error', cached_at: 0 })),
}));
jest.mock('../../services/courseGeometryService', () => ({
  fetchCourseGeometry: jest.fn(async () => ({ holes: Array.from({ length: 18 }, () => ({ green: { lat: 1, lng: 1 } })) })),
  loadDerivedGeometry: jest.fn(async () => undefined),
  mappedHoleCount: () => 18,
  getHoleGeometry: () => ({ tee: { lat: 41.25, lng: -73.02 }, green: { lat: 41.253, lng: -73.02 } }),
}));
jest.mock('../../services/mapboxImagery', () => ({
  isMapboxConfigured: () => true,
  prefetchHoles: jest.fn(async () => undefined),
  getHoleImageryUrl: () => null,
}));
jest.mock('../../services/golfCourseApi', () => {
  const actual = jest.requireActual('../../services/golfCourseApi');
  return {
    ...actual,
    searchCourses: jest.fn(async () => []),
    getCourse: jest.fn(async (id: string) => (id === 'gone' ? null : {
      id, club_name: 'Grassy Hill', course_name: 'Grassy Hill',
      location: { city: 'Orange', state: 'CT', country: 'US', latitude: 41.25, longitude: -73.02 },
      tees: [{ tee_name: 'W', course_rating: 70, slope_rating: 120, total_yards: 6200, par_total: 70,
        holes: Array.from({ length: 18 }, (_, i) => ({ hole_number: i + 1, par: 4, yardage: 350, handicap: i + 1 })) }],
      cached_at: Date.now(),
    })),
  };
});

import { downloadCourse, _resetDownloadEngineForTests } from '../../services/courseDownloadEngine';
import { fetchCourseIntelligence } from '../../services/courseIntelligenceService';
import { prefetchHoles } from '../../services/mapboxImagery';
import { searchCourses } from '../../services/golfCourseApi';
import { useDownloadedCoursesStore } from '../../store/downloadedCoursesStore';

describe('course build pipeline: one owner, visible progress, ready means playable', () => {
  let unsub: () => void;
  beforeEach(() => {
    _resetDownloadEngineForTests();
    contentNeverReturns = false;
    stagesSeen.length = 0;
    useDownloadedCoursesStore.setState({ downloaded: {}, downloading: {} } as never);
    unsub = useDownloadedCoursesStore.subscribe((s) => {
      const st = s.downloading['place:tapped']?.stage;
      if (st && stagesSeen[stagesSeen.length - 1] !== st) stagesSeen.push(st);
    });
  });
  afterEach(() => unsub());

  it('the tapped card watches card → map → imagery, then the course lands in Your courses', async () => {
    const r = await downloadCourse({ name: 'Grassy Hill', courseId: 'gh1', displayId: 'place:tapped' });
    expect(r).toMatchObject({ ok: true, courseId: 'gh1', fresh: true });
    expect(stagesSeen.slice(0, 3)).toEqual(['card', 'map', 'imagery']);
    const s = useDownloadedCoursesStore.getState();
    expect(s.downloaded.gh1?.greens).toBe(18);
    expect(s.downloading['place:tapped']).toBeUndefined();
    expect(s.downloading.gh1).toBeUndefined();
  });

  it('a paid generation that never returns cannot hold the course at "building"', async () => {
    contentNeverReturns = true;
    const r = await downloadCourse({ name: 'Grassy Hill', courseId: 'gh2' });
    expect(r.ok).toBe(true);
    expect(useDownloadedCoursesStore.getState().downloaded.gh2).toBeDefined();
  });

  it('a build that finds no course says why on the card', async () => {
    await downloadCourse({ name: 'Nowhere Links', courseId: 'place:none' });
    expect(useDownloadedCoursesStore.getState().downloading['place:none']?.failed).toMatch(/Nowhere Links/);
  });

  /** Let background work (the top-up is fire-and-forget) run to completion. */
  const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); };

  it('a course the nearby pre-load built still gets its brief when the player picks it', async () => {
    (fetchCourseIntelligence as jest.Mock).mockClear();
    (searchCourses as jest.Mock).mockResolvedValueOnce([{ id: 'nearY', club_name: 'Grassy Hill', course_name: 'Grassy Hill', location: '' }]);
    await downloadCourse({ name: 'Grassy Hill', courseId: 'place:abc', paidContent: false });
    expect(fetchCourseIntelligence).not.toHaveBeenCalled();
    await downloadCourse({ name: 'Grassy Hill', courseId: 'nearY' });
    await settle();
    expect(fetchCourseIntelligence).toHaveBeenCalled();
  });

  it('picking an owned course re-warms its hole imagery', async () => {
    useDownloadedCoursesStore.getState().markDownloaded({ courseId: 'owned1', name: 'Owned', holeCount: 18, at: 1, greens: 9 });
    (prefetchHoles as jest.Mock).mockClear();
    const r = await downloadCourse({ name: 'Owned', courseId: 'owned1' });
    await settle();
    expect(r).toMatchObject({ ok: true, fresh: false });
    expect(prefetchHoles).toHaveBeenCalled();
  });

  it('a card that failed to come back is "unavailable", not "not in the database"', async () => {
    (searchCourses as jest.Mock).mockResolvedValue([{ id: 'gone', club_name: 'Gone', course_name: 'Gone', location: '' }]);
    const r = await downloadCourse({ name: 'Gone Links', courseId: 'place:gone' });
    await downloadCourse({ name: 'Gone Links', courseId: 'place:gone' });
    expect(r).toMatchObject({ ok: false, reason: 'unavailable' });
    expect((searchCourses as jest.Mock).mock.calls.filter((c) => c[0] === 'Gone Links').length).toBe(2);
    (searchCourses as jest.Mock).mockResolvedValue([]);
  });

  it('a speculative build that finds nothing paints no failure on a card nobody tapped', async () => {
    await downloadCourse({ name: 'Driving Range', courseId: 'place:range', paidContent: false });
    expect(useDownloadedCoursesStore.getState().downloading['place:range']).toBeUndefined();
  });
});
