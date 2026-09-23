/**
 * 2026-09-23 (Tim) — "always switch automatically … quietly and quickly in the background."
 * Through the REAL round store: a layout switch replaces every layout-owned field and keeps
 * everything the player did; the runtime switches only on tee-box evidence, and never in a sim round.
 */
const mockTees: Record<string, Record<number, { lat: number; lng: number }>> = {};
let mockFix: { lat: number; lng: number; accuracy_m: number; speed: number; timestamp: number; source: 'live' } | null = null;
jest.mock('../../services/holeDetection', () => ({
  teeForHole: (courseId: string, hole: number) => mockTees[courseId]?.[hole] ?? null,
}));
jest.mock('../../services/gpsManager', () => ({ getLastFix: () => mockFix }));
// startRound fires the real prefetch; this suite is about the round store, not the network.
jest.mock('../../services/roundPrefetch', () => ({ prefetchRoundData: jest.fn(async () => 0) }));
jest.mock('../../services/courseGeometryService', () => ({ fetchCourseGeometry: jest.fn(async () => null) }));
jest.mock('../../services/golfCourseApi', () => {
  const card = (id: string, club: string, course: string) => ({
    id, club_name: club, course_name: course,
    location: { city: '', state: '', country: 'US', latitude: 30.19, longitude: -81.39 },
    tees: [{ tee_name: 'W', course_rating: 70, slope_rating: 120, total_yards: 6000, par_total: 72,
      holes: Array.from({ length: 18 }, (_, i) => ({ hole_number: i + 1, par: 4, yardage: 350, handicap: i + 1 })) }],
    cached_at: 0,
  });
  const actual = jest.requireActual('../../services/golfCourseApi');
  return {
    ...actual,
    getCourse: jest.fn(async (id: string) => {
      if (id === 'faraway') return { ...card('faraway', 'TPC Sawgrass', 'Namesake'), location: { city: '', state: '', country: 'US', latitude: 40.7, longitude: -74.0 } };
      return ({ dyes: card('dyes', 'TPC Sawgrass', "Dye's Valley"), stadium: card('stadium', 'TPC Sawgrass', 'Stadium') } as Record<string, unknown>)[id] ?? null;
    }),
    searchCourses: jest.fn(async () => [
      { id: 'dyes', club_name: 'TPC Sawgrass', course_name: "Dye's Valley", location: '' },
      { id: 'stadium', club_name: 'TPC Sawgrass', course_name: 'Stadium', location: '' },
      { id: 'other', club_name: 'Sawgrass Country Club', course_name: 'East', location: '' },
      { id: 'faraway', club_name: 'TPC Sawgrass', course_name: 'Namesake', location: '' },
    ]),
  };
});

import { useRoundStore } from '../../store/roundStore';
import { _tickForTests, _setSiblingsForTests, stopLayoutVerifier, DWELL_MS, resolveSiblings } from '../../services/layoutVerifier';

const holes = (n: number, par = 4, yd = 380) => Array.from({ length: n }, (_, i) => ({ hole: i + 1, par, distance: yd + i })) as never;

describe('switching the round to the layout the player is actually on', () => {
  beforeEach(() => {
    stopLayoutVerifier();
    useRoundStore.getState().startRound('Dye\'s Valley', holes(18, 4, 380), {
      nineHole: false, isCompetition: false, notes: '', goal: null, courseId: 'dyes', courseLocation: null,
    } as never);
    useRoundStore.getState().logScore(1, 5);
  });

  it('keeps scores and swaps pars, yardages, course and hole', () => {
    const before = useRoundStore.getState();
    before.switchRoundLayout({ courseId: 'stadium', courseName: 'TPC Sawgrass — Stadium', holes: holes(18, 3, 150), courseLocation: null, currentHole: 2 });
    const after = useRoundStore.getState();
    expect(after.activeCourseId).toBe('stadium');
    expect(after.activeCourse).toBe('TPC Sawgrass — Stadium');
    expect(after.courseHoles[0].par).toBe(3);
    expect(after.currentHole).toBe(2);
    expect(after.currentYardage).toBe(151);
    expect(after.scores).toEqual(before.scores);
    expect(after.scores[1]).toBe(5);
    expect(after.shots).toBe(before.shots);
    expect(after.isRoundActive).toBe(true);
  });

  it('a 9-hole layout inside an 18-hole round plays twice around', () => {
    useRoundStore.getState().switchRoundLayout({ courseId: 'nine', courseName: 'Nine', holes: holes(9), courseLocation: null, currentHole: 3 });
    const s = useRoundStore.getState();
    expect(s.courseHoles).toHaveLength(18);
    expect(s.courseHoles[9].hole).toBe(10);
    expect(s.twiceAround).toBe(true);
  });

  it('the runtime switches after the player stands on two of the sibling layout\'s tees', () => {
    // Active layout tees along one line; sibling tees ~85 yards east of them.
    mockTees.dyes = { 1: { lat: 30.194, lng: -81.39 }, 2: { lat: 30.198, lng: -81.39 } };
    mockTees.stadium = { 1: { lat: 30.194, lng: -81.3908 }, 2: { lat: 30.198, lng: -81.3908 } };
    _setSiblingsForTests('dyes', [{ courseId: 'stadium', courseName: 'TPC Sawgrass — Stadium', holes: holes(18, 3, 150), courseLocation: null }]);
    const realNow = Date.now;
    let now = 1_000_000;
    Date.now = () => now;
    try {
      const standOn = (p: { lat: number; lng: number }) => {
        for (let t = 0; t <= DWELL_MS + 4000; t += 4000) {
          now += 4000;
          mockFix = { ...p, accuracy_m: 5, speed: 0, timestamp: now, source: 'live' };
          _tickForTests();
        }
      };
      standOn(mockTees.stadium[1]);
      expect(useRoundStore.getState().activeCourseId).toBe('dyes');
      standOn(mockTees.stadium[2]);
      expect(useRoundStore.getState().activeCourseId).toBe('stadium');
      expect(useRoundStore.getState().currentHole).toBe(2);
    } finally {
      Date.now = realNow;
    }
  });

  it('never in a simulated round', () => {
    useRoundStore.setState({ isSimRound: true } as never);
    mockTees.dyes = { 1: { lat: 30.194, lng: -81.39 } };
    mockTees.far = { 7: { lat: 30.30, lng: -81.60 } };
    _setSiblingsForTests('dyes', [{ courseId: 'far', courseName: 'Far', holes: holes(18), courseLocation: null }]);
    const realNow = Date.now;
    let now = 2_000_000;
    Date.now = () => now;
    try {
      for (let t = 0; t <= DWELL_MS + 8000; t += 4000) {
        now += 4000;
        mockFix = { ...mockTees.far[7], accuracy_m: 5, speed: 0, timestamp: now, source: 'live' };
        _tickForTests();
      }
    } finally {
      Date.now = realNow;
    }
    expect(useRoundStore.getState().activeCourseId).toBe('dyes');
  });

  it('finds the other layouts of a bundled complex (Menifee Palms → Lakes)', async () => {
    const sibs = await resolveSiblings('local:palms', 'Menifee Lakes Palms');
    expect(sibs.map((x) => x.courseId)).toEqual(['local:lakes']);
    expect(sibs[0].holes.length).toBeGreaterThan(0);
  });

  it('finds the other layouts of a database club — never a different club, never a namesake in another state', async () => {
    const sibs = await resolveSiblings('dyes', "TPC Sawgrass — Dye's Valley");
    expect(sibs.map((x) => x.courseId)).toEqual(['stadium']);
  });

  it('a single-layout course has no siblings', async () => {
    expect(await resolveSiblings('local:mines-gc', 'The Mines Golf Course')).toEqual([]);
  });
});
