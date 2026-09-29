/**
 * 2026-09-28 (Tim's issue log, Hemet Golf Club):
 *
 *   analysis_error: course_search_failed · hole 3  · query: Hemet Golf Club · Course search unavailable — check connection
 *   analysis_error: course_search_failed · hole 14 · query: Hemet Golf Club · Course search unavailable — check connection
 *
 * Nobody searched. The tee-box layout verifier (services/layoutVerifier) resolves a course's sister
 * layouts by searching its club name, and resolveSiblings dropped the search's error row like any other
 * non-match — so "could not ask" and "this is a single-course club" both came back as [], and [] was
 * re-searched every 10 minutes. A single-course round searched ~25 times in the background, and each
 * one that landed in a dead spot filed a player-facing connection error.
 *
 * Now: an empty answer is settled for the round; a failure is retried after a pause; and a background
 * search that fails is a diagnostic, not an error for the player to wonder about.
 */
const mockSearch = jest.fn();
const mockGetCourse = jest.fn();
jest.mock('../../services/holeDetection', () => ({ teeForHole: () => null }));
jest.mock('../../services/gpsManager', () => ({ getLastFix: () => null }));
jest.mock('../../services/roundPrefetch', () => ({ prefetchRoundData: jest.fn(async () => 0) }));
jest.mock('../../services/courseGeometryService', () => ({ fetchCourseGeometry: jest.fn(async () => null) }));
jest.mock('../../services/golfCourseApi', () => {
  const actual = jest.requireActual('../../services/golfCourseApi');
  return { ...actual, getCourse: (...a: unknown[]) => mockGetCourse(...a), searchCourses: (...a: unknown[]) => mockSearch(...a) };
});

import { useRoundStore } from '../../store/roundStore';
import { _tickForTests, stopLayoutVerifier, resolveSiblings, SiblingLookupFailed, RETRY_AFTER_FAILURE_MS, MAX_LOOKUP_FAILURES } from '../../services/layoutVerifier';

const hemetCard = {
  id: 'hemet', club_name: 'Hemet Golf Club', course_name: 'Hemet Golf Club',
  location: { city: 'Hemet', state: 'CA', country: 'US', latitude: 33.74, longitude: -116.97 },
  tees: [], cached_at: 0,
};
const ownRowOnly = [{ id: 'hemet', club_name: 'Hemet Golf Club', course_name: 'Hemet Golf Club', location: '' }];
const failedRow = [{ id: '', club_name: '', course_name: '', location: '', _error: 'Course search unavailable — check connection' }];
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const holes = Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, distance: 380 })) as never;

let now = 5_000_000;
let nowSpy: jest.SpyInstance<number, []>;

beforeEach(() => {
  mockSearch.mockReset();
  mockGetCourse.mockReset().mockResolvedValue(hemetCard);
  stopLayoutVerifier();
  now = 5_000_000;
  nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
  useRoundStore.getState().startRound('Hemet Golf Club', holes, {
    nineHole: false, isCompetition: false, notes: '', goal: null, courseId: 'hemet', courseLocation: null,
  } as never);
});
afterEach(() => nowSpy.mockRestore());

describe('sister-layout lookup', () => {
  it('a failed search is a FAILURE, not "no sister courses"', async () => {
    mockSearch.mockResolvedValue(failedRow);
    await expect(resolveSiblings('hemet', 'Hemet Golf Club')).rejects.toBeInstanceOf(SiblingLookupFailed);
  });

  it('asks the search as a background lookup', async () => {
    mockSearch.mockResolvedValue(ownRowOnly);
    await resolveSiblings('hemet', 'Hemet Golf Club');
    expect(mockSearch).toHaveBeenCalledWith('Hemet Golf Club', { background: true });
  });

  it('a card that does not come back is a failure too', async () => {
    mockGetCourse.mockResolvedValue(null);
    await expect(resolveSiblings('hemet', 'Hemet Golf Club')).rejects.toBeInstanceOf(SiblingLookupFailed);
  });

  it('THE BUG (2026-09-30 review): one broken sister card does not throw away the good ones', async () => {
    const sisterRow = (id: string) => ({ id, club_name: 'Hemet Golf Club', course_name: `Course ${id}`, location: '' });
    mockSearch.mockResolvedValue([...ownRowOnly, sisterRow('good'), sisterRow('broken')]);
    const goodCard = { ...hemetCard, id: 'good', course_name: 'Course good',
      tees: [{ tee_name: 'Blue', holes: Array.from({ length: 18 }, (_, i) => ({ hole_number: i + 1, par: 4, yardage: 380 })) }] };
    mockGetCourse.mockImplementation(async (id: string) => (id === 'hemet' ? hemetCard : id === 'good' ? goodCard : null));
    const out = await resolveSiblings('hemet', 'Hemet Golf Club');
    expect(out.map((s) => s.courseId)).toEqual(['good']);
  });

  it('found sisters but NONE resolved is still a failed lookup (retried)', async () => {
    mockSearch.mockResolvedValue([...ownRowOnly, { id: 'broken', club_name: 'Hemet Golf Club', course_name: 'B', location: '' }]);
    mockGetCourse.mockImplementation(async (id: string) => (id === 'hemet' ? hemetCard : null));
    await expect(resolveSiblings('hemet', 'Hemet Golf Club')).rejects.toBeInstanceOf(SiblingLookupFailed);
  });
});

describe('THE BUG: a single-course round searches once, not every ten minutes', () => {
  it('an empty answer is settled for the whole round', async () => {
    mockSearch.mockResolvedValue(ownRowOnly);
    _tickForTests(); await flush();
    expect(mockSearch).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 30; i++) { now += 10 * 60 * 1000; _tickForTests(); await flush(); } // five hours
    expect(mockSearch).toHaveBeenCalledTimes(1);
  });

  it('a failure waits, then asks again — and stops once it gets an answer', async () => {
    mockSearch.mockResolvedValueOnce(failedRow).mockResolvedValue(ownRowOnly);
    _tickForTests(); await flush();
    expect(mockSearch).toHaveBeenCalledTimes(1);
    now += 4_000; _tickForTests(); await flush(); // the next poll does NOT hammer a dead connection
    expect(mockSearch).toHaveBeenCalledTimes(1);
    now += RETRY_AFTER_FAILURE_MS; _tickForTests(); await flush(); // clears the failure
    _tickForTests(); await flush();                                // re-asks
    expect(mockSearch).toHaveBeenCalledTimes(2);
    for (let i = 0; i < 10; i++) { now += RETRY_AFTER_FAILURE_MS + 1; _tickForTests(); await flush(); }
    expect(mockSearch).toHaveBeenCalledTimes(2);
  });
});

describe('a course in a dead zone is not searched all round', () => {
  it('THE BUG: failures are retried a bounded number of times, then the round stops asking', async () => {
    mockSearch.mockResolvedValue(failedRow);
    for (let i = 0; i < 80; i++) { _tickForTests(); await flush(); now += RETRY_AFTER_FAILURE_MS + 1; } // four hours
    expect(mockSearch).toHaveBeenCalledTimes(MAX_LOOKUP_FAILURES);
  });
});

describe('a partial sister-course answer is retried, within the cap (triple-check 2026-09-30)', () => {
  it('one sister card missing in a dead spot → keep the good one, ask again after the pause, stop at the cap', async () => {
    const row = (id: string) => ({ id, club_name: 'Hemet Golf Club', course_name: `Course ${id}`, location: '' });
    const card = (id: string) => ({ ...hemetCard, id, course_name: `Course ${id}`,
      tees: [{ tee_name: 'Blue', holes: Array.from({ length: 18 }, (_, i) => ({ hole_number: i + 1, par: 4, yardage: 380 })) }] });
    mockSearch.mockResolvedValue([...ownRowOnly, row('good'), row('flaky')]);
    mockGetCourse.mockImplementation(async (id: string) => (id === 'hemet' ? hemetCard : id === 'good' ? card('good') : null));
    _tickForTests(); await flush();
    expect(mockSearch).toHaveBeenCalledTimes(1);
    now += RETRY_AFTER_FAILURE_MS + 1; _tickForTests(); await flush(); _tickForTests(); await flush();
    expect(mockSearch).toHaveBeenCalledTimes(2);  // THE BUG: a partial answer was settled for the round
    for (let i = 0; i < 20; i++) { now += RETRY_AFTER_FAILURE_MS + 1; _tickForTests(); await flush(); }
    expect(mockSearch).toHaveBeenCalledTimes(MAX_LOOKUP_FAILURES);
  });
});

describe('a background search that fails is a diagnostic, not a player-facing error', () => {
  it('logs diag for background, analysis_error for a search the player made', async () => {
    const actual = jest.requireActual('../../services/golfCourseApi') as typeof import('../../services/golfCourseApi');
    const { useIssueLogStore } = require('../../store/issueLogStore') as typeof import('../../store/issueLogStore');
    const spy = jest.spyOn(useIssueLogStore.getState(), 'addAppEvent');
    const realFetch = global.fetch;
    global.fetch = jest.fn(async () => { throw new TypeError('Network request failed'); }) as unknown as typeof fetch;
    try {
      await actual.searchCourses('Hemet Golf Club', { background: true });
      await actual.searchCourses('Hemet Golf Club');
    } finally {
      global.fetch = realFetch;
    }
    const failed = spy.mock.calls.filter((c) => c[0] === 'course_search_failed');
    expect(failed).toHaveLength(2);
    expect(failed[0][2]).toBe('diag');
    expect(failed[1][2]).toBe('analysis_error');
    spy.mockRestore();
  });
});
