/**
 * 2026-09-23 — "some courses won't load", "a little glitchy", and an overage on the Claude bill.
 *
 * One shape underneath all three: every surface that touches a course started its own load, and
 * nothing joined them or remembered a failure. Production on 09-23 (deduplicated Vercel logs): one
 * course open fired course-locate twice in the same second, ~9 golfcourseapi searches for one name,
 * and seven paid course-content generations in eleven seconds — all of which timed out (17/17 that
 * week), so nothing cached and the next open bought them again. The shared golfcourseapi key then hit
 * "daily usage limit exceeded" and every uncached course in the app stopped loading.
 *
 * Every assertion here is behavioural, through the real module with only the network stubbed.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('../../store/settingsStore', () => ({
  useSettingsStore: { getState: () => ({ hasHydrated: true, voiceGender: 'male', caddiePersonality: 'kevin' }) },
}));
jest.mock('../../services/roundPrefetch', () => ({
  prefetchRoundData: jest.fn(async () => 18),
}));
jest.mock('../../services/golfCourseApi', () => {
  const actual = jest.requireActual('../../services/golfCourseApi');
  return { ...actual, searchCourses: jest.fn(), getCourse: jest.fn() };
});

import * as content from '../../services/courseContentService';
import * as engine from '../../services/courseDownloadEngine';
import * as gca from '../../services/golfCourseApi';
import { useDownloadedCoursesStore } from '../../store/downloadedCoursesStore';

const INPUT = {
  courseId: 'api123', courseName: 'Grassy Hill Country Club', par: 70, yardage: 6200,
  holes: [{ hole_number: 1, par: 4, yardage: 380 }],
};
const CONTENT = { about: 'a', caddie_tips: ['t'], hole_notes: [{ hole_number: 1, note: 'n' }], hole_descriptions: [] };

function card(id: string, name: string) {
  return {
    id, club_name: name, course_name: name,
    location: { city: 'Orange', state: 'CT', country: 'US', latitude: 41.25, longitude: -73.02 },
    tees: [{
      tee_name: 'White', course_rating: 70, slope_rating: 120, total_yards: 6200, par_total: 70,
      holes: Array.from({ length: 18 }, (_, i) => ({ hole_number: i + 1, par: 4, yardage: 350, handicap: i + 1 })),
    }],
    cached_at: Date.now(),
  };
}

describe('course content: one paid generation per course, and none straight after a failure', () => {
  beforeEach(() => { content._clearCourseContentCache(); });

  it('three surfaces asking at once share ONE generation', async () => {
    let calls = 0;
    (global as { fetch: unknown }).fetch = jest.fn(async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 5));
      return { ok: true, status: 200, json: async () => CONTENT };
    });
    const out = await Promise.all([
      content.fetchCourseContent(INPUT), content.fetchCourseContent(INPUT), content.fetchCourseContent(INPUT),
    ]);
    expect(calls).toBe(1);
    expect(out.every((c) => c?.about === 'a')).toBe(true);
  });

  it('a failed generation is not re-bought on the next open', async () => {
    let calls = 0;
    (global as { fetch: unknown }).fetch = jest.fn(async () => { calls++; return { ok: false, status: 503, json: async () => ({}) }; });
    expect(await content.fetchCourseContent({ ...INPUT, courseId: 'fails' })).toBeNull();
    expect(await content.fetchCourseContent({ ...INPUT, courseId: 'fails' })).toBeNull();
    expect(calls).toBe(1);
  });

  it('a persona switch clears the content it actually stored', async () => {
    (global as { fetch: unknown }).fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => CONTENT }));
    await content.fetchCourseContent({ ...INPUT, courseId: 'persona' });
    expect((await AsyncStorage.getAllKeys()).some((k) => k.includes('persona'))).toBe(true);
    await content.clearCourseContentCache();
    expect((await AsyncStorage.getAllKeys()).some((k) => k.includes('persona'))).toBe(false);
  });
});

describe('course download engine: the id the player picked is the course that downloads, once', () => {
  const search = gca.searchCourses as jest.Mock;
  const detail = gca.getCourse as jest.Mock;
  beforeEach(() => {
    engine._resetDownloadEngineForTests();
    search.mockReset(); detail.mockReset();
    useDownloadedCoursesStore.setState({ downloaded: {} } as never);
  });

  it('an explicit golfcourseapi id is loaded by id — no name search, no first-hit substitution', async () => {
    // The first search hit is the WRONG course at a multi-course club; it must never be consulted.
    search.mockResolvedValue([{ id: 'yellow', club_name: 'Bethpage', course_name: 'Yellow', location: '' }]);
    detail.mockImplementation(async (id: string) => card(id, id === 'black' ? 'Bethpage Black' : 'Bethpage Yellow'));
    const r = await engine.downloadCourse({ name: 'Bethpage', courseId: 'black' });
    expect(r).toMatchObject({ ok: true, courseId: 'black' });
    expect(search).not.toHaveBeenCalled();
    expect(detail).toHaveBeenCalledWith('black');
  });

  it('two runs for the same course at once share one download', async () => {
    detail.mockImplementation(async (id: string) => { await new Promise((r) => setTimeout(r, 5)); return card(id, 'Grassy Hill'); });
    await Promise.all([engine.downloadCourse({ name: 'Grassy Hill', courseId: 'gh' }), engine.downloadCourse({ name: 'Grassy Hill', courseId: 'gh' })]);
    expect(detail).toHaveBeenCalledTimes(1);
  });

  it('a nearby place that resolves to nothing is not re-searched on every open', async () => {
    search.mockResolvedValue([]);
    await engine.downloadCourse({ name: 'Mystery Links', courseId: 'place:abc' });
    await engine.downloadCourse({ name: 'Mystery Links', courseId: 'place:abc' });
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('a search that FAILED is not remembered as "no such course"', async () => {
    search.mockResolvedValue([{ id: '', club_name: '', course_name: '', location: '', _error: 'Search unavailable (503)' }]);
    const r1 = await engine.downloadCourse({ name: 'Flaky Links', courseId: 'place:def' });
    await engine.downloadCourse({ name: 'Flaky Links', courseId: 'place:def' });
    expect(r1).toMatchObject({ ok: false, reason: 'unavailable' });
    expect(search).toHaveBeenCalledTimes(2);
  });

  it('a course the player picked by id is retried on the next ask even if it failed', async () => {
    detail.mockResolvedValue(null);
    search.mockResolvedValue([]);
    await engine.downloadCourse({ name: 'Picked', courseId: 'picked1' });
    await engine.downloadCourse({ name: 'Picked', courseId: 'picked1' });
    expect(detail).toHaveBeenCalledTimes(2);
  });

  it('an id with no record still falls back to the name (a voice-invented id must not dead-end)', async () => {
    detail.mockImplementation(async (id: string) => (id === 'real9' ? card('real9', 'Pebble Beach') : null));
    search.mockResolvedValue([{ id: 'real9', club_name: 'Pebble Beach', course_name: 'Pebble Beach', location: '' }]);
    const r = await engine.downloadCourse({ name: 'Pebble Beach', courseId: 'pebble-beach-golf-links' });
    expect(r).toMatchObject({ ok: true, courseId: 'real9' });
  });

  it('failure reasons reach the player as words, not codes', () => {
    expect(engine.downloadFailureText('X', 'unresolved')).not.toMatch(/unresolved/);
    expect(engine.downloadFailureText('X', 'unavailable')).not.toMatch(/unavailable/);
  });
});

describe('nearby discovery: one lookup per spot at a time', () => {
  beforeEach(() => { engine._resetDownloadEngineForTests(); });

  it('the Play tab\'s two position updates share one course-locate call', async () => {
    let calls = 0;
    (global as { fetch: unknown }).fetch = jest.fn(async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 5));
      return { ok: true, status: 200, json: async () => ({ courses: [] }) };
    });
    await Promise.all([
      engine.locateNearbyCourses(41.2501, -73.0201, { limit: 8 }),
      engine.locateNearbyCourses(41.2502, -73.0202, { limit: 8 }),
    ]);
    expect(calls).toBe(1);
  });
});

describe('course search errors are words', () => {
  it('the daily limit and our own throttle are named, and never shown as a status code', () => {
    expect(gca.searchErrorMessage(429, 'course_db_daily_limit')).not.toMatch(/429|Upstream/);
    expect(gca.searchErrorMessage(429, 'rate_limited')).not.toMatch(/429|Upstream/);
  });
});
