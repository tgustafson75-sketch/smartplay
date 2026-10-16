/**
 * 2026-10-15 (review G3a, finding 10) — A FRESH DETAIL WITH NO TEES DOES NOT BEAT A CARD WE HAVE.
 *
 * golfCourseApi.getCourseInner returned a fresh 200 even when it normalised to NO tees, over a stale
 * cached course that had them. courseCard.readDatabaseCard reads "no tees" as an empty record, so the
 * round started with no holes at a course this phone already knew. The error exits already prefer the
 * stale card; a usable-looking 200 with nothing in it now does too.
 */
const files = new Map<string, string>();
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: '/docs/',
  cacheDirectory: '/tmp/',
  getInfoAsync: async (p: string) => ({ exists: p.endsWith('/') || files.has(p) }),
  makeDirectoryAsync: async () => {},
  readAsStringAsync: async (p: string) => files.get(p) ?? '',
  writeAsStringAsync: async (p: string, v: string) => { files.set(p, v); },
  deleteAsync: async () => {},
}));

import { getCourse } from '../../services/golfCourseApi';

const ID = '4242';
const STALE = Date.now() - 400 * 24 * 60 * 60 * 1000; // far past the 30-day TTL

function seedCache(tees: unknown[]) {
  files.set(`/docs/course_cache/${ID}.json`, JSON.stringify({
    id: ID, club_name: 'Known GC', course_name: 'Known GC',
    location: { city: 'X', state: 'CA', country: 'US' },
    tees, cached_at: STALE,
  }));
}

function serve(body: unknown) {
  global.fetch = jest.fn(async () => ({
    ok: true, status: 200, json: async () => body,
  })) as unknown as typeof fetch;
}

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; files.clear(); });

const goodTee = {
  tee_name: 'White', course_rating: 70, slope_rating: 120, total_yards: 6000, par_total: 72,
  holes: Array.from({ length: 18 }, () => ({ par: 4, yardage: 380, handicap: 1 })),
};

describe('getCourse keeps a usable cached card over a tee-less fresh answer', () => {
  it('a 200 that normalises to no tees returns the stale cached card', async () => {
    seedCache([goodTee]);
    serve({ course: { id: ID, club_name: 'Known GC', tees: {} } });
    const c = await getCourse(ID);
    expect(c?.tees.length ?? 0).toBeGreaterThan(0);
  });

  it('a 200 WITH tees still replaces the stale card (the refresh is not blocked)', async () => {
    seedCache([goodTee]);
    serve({ course: { id: ID, club_name: 'Renamed GC', tees: { male: [goodTee] } } });
    const c = await getCourse(ID);
    expect(c?.club_name).toBe('Renamed GC');
  });

  it('no cached card: the tee-less fresh answer is still returned (an honest empty record)', async () => {
    serve({ course: { id: ID, club_name: 'Empty GC', tees: {} } });
    const c = await getCourse(ID);
    expect(c?.club_name).toBe('Empty GC');
    expect(c?.tees.length).toBe(0);
  });
});
