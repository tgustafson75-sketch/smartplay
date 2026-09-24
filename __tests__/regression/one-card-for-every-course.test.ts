/**
 * 2026-09-23 (Tim) — "Unify the pipeline." services/courseCard is the ONE answer to "what is this
 * course" for every id the app holds. Round start, the download engine and the Play tab resolve
 * through it; before, each had its own `local:` branch and its own idea of a course.
 */
const mockNetworkCalls: string[] = [];
jest.mock('../../services/golfCourseApi', () => {
  const actual = jest.requireActual('../../services/golfCourseApi');
  const card = {
    id: 'e90nbvs4', club_name: 'TPC Sawgrass', course_name: "Dye's Valley",
    location: { city: '', state: '', country: 'US', latitude: 30.199, longitude: -81.3948 },
    tees: [{ tee_name: 'Blue', course_rating: 71.2, slope_rating: 131, total_yards: 6800, par_total: 72,
      holes: Array.from({ length: 18 }, (_, i) => ({ hole_number: i + 1, par: 4, yardage: 380, handicap: i + 1 })) }],
    cached_at: 0,
  };
  return {
    ...actual,
    getCourse: jest.fn(async (id: string) => { mockNetworkCalls.push(id); return id === 'e90nbvs4' || id === '3j4b4ar8' ? { ...card, id } : null; }),
    peekCachedCourse: jest.fn(async (id: string) => (id === 'e90nbvs4' ? card : null)),
  };
});

import { loadCourseCard } from '../../services/courseCard';

describe('one course card for every kind of course', () => {
  beforeEach(() => { mockNetworkCalls.length = 0; });

  it('a surveyed course: its verified holes, its rating/slope, and its OWN location', async () => {
    const c = await loadCourseCard('local:palms');
    expect(c?.source).toBe('surveyed');
    expect(c?.courseId).toBe('local:palms');
    expect(c?.holes).toHaveLength(18);
    expect(c?.location).not.toBeNull();
    expect(mockNetworkCalls).toEqual([]);
  });

  it('a database course: its card on the player\'s tee, with the TEE\'s rating and slope', async () => {
    const c = await loadCourseCard('e90nbvs4');
    expect(c?.source).toBe('database');
    expect(c?.name).toMatch(/Dye's Valley/);
    expect(c?.rating).toBe(71.2);
    expect(c?.slope).toBe(131);
    expect(c?.location).toEqual({ lat: 30.199, lng: -81.3948 });
  });

  it('offline mode answers only from this device — never a request', async () => {
    const c = await loadCourseCard('e90nbvs4', { network: false });
    expect(c?.holes).toHaveLength(18);
    expect(mockNetworkCalls).toEqual([]);
    expect(await loadCourseCard('uncached-id', { network: false })).toBeNull();
    expect(mockNetworkCalls).toEqual([]);
  });

  it('a marquee slug with no surveyed card resolves to its pinned database record, keeping its id', async () => {
    const c = await loadCourseCard('local:pebble-beach');
    expect(c?.source).toBe('database');
    expect(c?.courseId).toBe('local:pebble-beach');
    expect(mockNetworkCalls).toEqual(['3j4b4ar8']);
  });

  it('an unknown id is null, not a guess', async () => {
    expect(await loadCourseCard('local:no-such-course')).toBeNull();
    expect(await loadCourseCard('')).toBeNull();
  });
});
