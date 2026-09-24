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
      { tee_name: 'Blue', holes: [{ yardage: 555 }, { yardage: 170 }, { yardage: 353 }, { yardage: 411 }] },
      { tee_name: 'White', holes: [{ yardage: 520 }, { yardage: 150 }, { yardage: 330 }, { yardage: 390 }] },
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

  it('backTeeYards takes the longest tee per hole and ignores nonsense', () => {
    expect(geo.backTeeYards({ tees: [{ holes: [{ yardage: 300 }, { yardage: 0 }] }, { holes: [{ yardage: 320 }, { yardage: 5000 }] }] })).toEqual([320, 0]);
  });

  it('a bundled course keeps its own card and never asks the database', async () => {
    const { peekCachedCourse } = jest.requireMock('../../services/golfCourseApi') as { peekCachedCourse: jest.Mock };
    peekCachedCourse.mockClear();
    await geo.fetchCourseGeometry('local:palms');
    expect(peekCachedCourse).not.toHaveBeenCalled();
  });
});
