/**
 * 2026-09-23 — a DATABASE course sends its back-tee card to the geometry engine.
 *
 * Only bundled courses did, so for golfcourseapi courses the engine picked OSM hole routes by geometry
 * alone and its scorecard veto never ran: TPC Sawgrass Dye's Valley was built from the Stadium course's
 * routes, 75% off its card. Measured live the same day — sent the card, Dye's Valley built its OWN
 * holes, 11.6% off. The back tee's yardage, because OSM routes start there.
 */
jest.mock('../../services/golfCourseApi', () => ({
  getCourse: jest.fn(async () => { throw new Error('a build must not fetch a card from the network'); }),
  peekCachedCourse: jest.fn(async () => ({
    id: 'e90nbvs4', club_name: 'TPC Sawgrass', course_name: "Dye's Valley",
    tees: [
      { tee_name: 'Blue', total_yards: 1489, holes: [{ hole_number: 1, yardage: 555 }, { hole_number: 2, yardage: 170 }, { hole_number: 3, yardage: 353 }, { hole_number: 4, yardage: 411 }] },
      { tee_name: 'White', total_yards: 1390, holes: [{ hole_number: 1, yardage: 520 }, { hole_number: 2, yardage: 150 }, { hole_number: 3, yardage: 330 }, { hole_number: 4, yardage: 390 }] },
    ],
  })),
}));

import * as geo from '../../services/courseGeometryService';

describe('the geometry request carries the course\'s own card', () => {
  let urls: string[] = [];
  beforeEach(() => {
    urls = [];
    geo._clearGeometryCache();
    (global as { fetch: unknown }).fetch = jest.fn(async (u: string) => { urls.push(u); return { ok: true, status: 200, json: async () => ({ course_id: 'x', course_name: 'x', holes: [] }) }; });
  });

  it('a golfcourseapi course sends the BACK-tee yardage per hole, from the cached card — no network', async () => {
    await geo.fetchCourseGeometry('e90nbvs4', { courseLocation: { lat: 30.199, lng: -81.3948 } });
    const u = new URL(urls[0]);
    expect(u.searchParams.get('cardYards')).toBe('555,170,353,411');
  });

  it('backTeeYards places yardages by HOLE NUMBER, from one real tee set', () => {
    // The second set is stored out of order; array-index pooling produced [400, 420].
    expect(geo.backTeeYards({ tees: [
      { total_yards: 570, holes: [{ hole_number: 1, yardage: 400 }, { hole_number: 2, yardage: 170 }] },
      { total_yards: 600, holes: [{ hole_number: 2, yardage: 180 }, { hole_number: 1, yardage: 420 }] },
    ] })).toEqual([420, 180]);
  });

  it('a partial tee set never lends its yardage to another hole', () => {
    // A 9-hole "back nine" set stored at 0-8 must not put its hole-10 par 5 in hole 1's slot.
    const full = Array.from({ length: 18 }, (_, i) => ({ hole_number: i + 1, yardage: i === 0 ? 160 : 400 }));
    const backNine = Array.from({ length: 9 }, (_, i) => ({ hole_number: i + 10, yardage: 560 }));
    const out = geo.backTeeYards({ tees: [{ total_yards: 5040, holes: backNine }, { total_yards: 6960, holes: full }] });
    expect(out[0]).toBe(160);
    expect(out).toHaveLength(18);
  });

  it('the WEEKLY background refresh carries the same card as the first build', async () => {
    const AsyncStorage = (jest.requireActual('../../__tests__/mocks/asyncStorage') as { default: { setItem: (k: string, v: string) => Promise<void> } }).default;
    const greens = Array.from({ length: 18 }, (_, i) => ({ hole_number: i + 1, par: 4, yardage: 400, tee: { lat: 30.19 + i * 0.001, lng: -81.39 }, green: { lat: 30.1903 + i * 0.001, lng: -81.39 } }));
    await AsyncStorage.setItem('course-geometry-v3::e90nbvs4', JSON.stringify({
      course_id: 'e90nbvs4', course_name: 'x', holes: greens, pipeline_version: 3, fetched_at: Date.now() - 8 * 24 * 3600 * 1000,
    }));
    await geo.fetchCourseGeometry('e90nbvs4', { courseLocation: { lat: 30.199, lng: -81.3948 } });
    for (let i = 0; i < 20; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(urls.length).toBeGreaterThan(0);
    expect(new URL(urls[urls.length - 1]).searchParams.get('cardYards')).toBe('555,170,353,411');
  });

  it('a bundled course keeps its own card and never asks the database', async () => {
    const { peekCachedCourse } = jest.requireMock('../../services/golfCourseApi') as { peekCachedCourse: jest.Mock };
    peekCachedCourse.mockClear();
    await geo.fetchCourseGeometry('local:palms');
    expect(peekCachedCourse).not.toHaveBeenCalled();
  });
});
