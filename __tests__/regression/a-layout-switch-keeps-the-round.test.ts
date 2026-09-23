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
import { fetchCourseGeometry } from '../../services/courseGeometryService';

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
    // A fully mapped active layout: its absence near the player only means something when its tees are known.
    mockTees.dyes = Object.fromEntries(Array.from({ length: 18 }, (_, i) => [i + 1, { lat: 30.194 + i * 0.004, lng: -81.39 }]));
    // Logging hole 1 (beforeEach) moved the round to hole 2: the tees that count are 2 and 3.
    expect(useRoundStore.getState().currentHole).toBe(2);
    mockTees.stadium = { 2: { lat: 30.198, lng: -81.3908 }, 3: { lat: 30.202, lng: -81.3908 } };
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
      standOn(mockTees.stadium[2]);
      expect(useRoundStore.getState().activeCourseId).toBe('dyes');
      standOn(mockTees.stadium[3]);
      expect(useRoundStore.getState().activeCourseId).toBe('stadium');
      expect(useRoundStore.getState().currentHole).toBe(3);
    } finally {
      Date.now = realNow;
    }
  });

  it('never in a simulated round', () => {
    useRoundStore.setState({ isSimRound: true } as never);
    mockTees.dyes = { 1: { lat: 30.194, lng: -81.39 } };
    // The player's CURRENT hole (2, after the logged hole 1), so only the sim-round gate can stop it.
    mockTees.dyes = Object.fromEntries(Array.from({ length: 18 }, (_, i) => [i + 1, { lat: 30.194 + i * 0.004, lng: -81.39 }]));
    mockTees.far = { 2: { lat: 30.30, lng: -81.60 } };
    _setSiblingsForTests('dyes', [{ courseId: 'far', courseName: 'Far', holes: holes(18), courseLocation: null }]);
    const realNow = Date.now;
    let now = 2_000_000;
    Date.now = () => now;
    try {
      for (let t = 0; t <= DWELL_MS + 8000; t += 4000) {
        now += 4000;
        mockFix = { ...mockTees.far[2], accuracy_m: 5, speed: 0, timestamp: now, source: 'live' };
        _tickForTests();
      }
    } finally {
      Date.now = realNow;
    }
    expect(useRoundStore.getState().activeCourseId).toBe('dyes');
  });

  it('finds the other layouts of a bundled complex (Menifee Palms → Lakes) and builds their maps', async () => {
    (fetchCourseGeometry as jest.Mock).mockClear();
    const sibs = await resolveSiblings('local:palms', 'Menifee Lakes Palms');
    expect(sibs.map((x) => x.courseId)).toEqual(['local:lakes']);
    expect(sibs[0].holes.length).toBeGreaterThan(0);
    // Gleneagles ships no surveyed tees: a bundled sibling's tees can come only from its engine map.
    expect(fetchCourseGeometry).toHaveBeenCalledWith('local:lakes');
  });

  it('finds the other layouts of a database club — never a different club, never a namesake in another state', async () => {
    const sibs = await resolveSiblings('dyes', "TPC Sawgrass — Dye's Valley");
    expect(sibs.map((x) => x.courseId)).toEqual(['stadium']);
  });

  it('a single-layout course has no siblings', async () => {
    expect(await resolveSiblings('local:mines-gc', 'The Mines Golf Course')).toEqual([]);
  });

  it('switching a twice-around round to an 18-hole layout ends the twice-around', () => {
    useRoundStore.getState().switchRoundLayout({ courseId: 'nine', courseName: 'Nine', holes: holes(9), courseLocation: null, currentHole: 3 });
    expect(useRoundStore.getState().twiceAround).toBe(true);
    useRoundStore.getState().switchRoundLayout({ courseId: 'eighteen', courseName: 'Eighteen', holes: holes(18), courseLocation: null, currentHole: 4 });
    expect(useRoundStore.getState().twiceAround).toBe(false);
  });

  it('a switch never lands the player on a hole that already has a score', () => {
    mockTees.dyes = Object.fromEntries(Array.from({ length: 18 }, (_, i) => [i + 1, { lat: 30.194 + i * 0.004, lng: -81.39 }]));
    // Player on hole 3; hole 4 already carries a score (entered ahead). The sibling's 3 and 4 tees
    // prove the layout — and the switch must not move the player onto the scored hole 4.
    mockTees.stadium = { 3: { lat: 30.202, lng: -81.3908 }, 4: { lat: 30.206, lng: -81.3908 } };
    useRoundStore.getState().logScore(4, 4);
    useRoundStore.getState().setCurrentHole(3);
    const holeBefore = useRoundStore.getState().currentHole;
    _setSiblingsForTests('dyes', [{ courseId: 'stadium', courseName: 'Stadium', holes: holes(18, 3, 150), courseLocation: null }]);
    const realNow = Date.now;
    let now = 3_000_000;
    Date.now = () => now;
    try {
      for (const p of [mockTees.stadium[3], mockTees.stadium[4]]) {
        for (let t = 0; t <= DWELL_MS + 4000; t += 4000) {
          now += 4000;
          mockFix = { ...p, accuracy_m: 5, speed: 0, timestamp: now, source: 'live' };
          _tickForTests();
        }
      }
    } finally {
      Date.now = realNow;
    }
    expect(useRoundStore.getState().activeCourseId).toBe('stadium');
    expect(useRoundStore.getState().currentHole).toBe(holeBefore);
    expect(useRoundStore.getState().scores[4]).toBe(4);
  });

  it('twice-around nine → 18-hole layout lands on the 18-hole layout\'s own hole, not hole+9', () => {
    useRoundStore.getState().switchRoundLayout({ courseId: 'nine', courseName: 'Nine', holes: holes(9), courseLocation: null, currentHole: 3 });
    useRoundStore.setState({ currentHole: 12 } as never);
    mockTees.nine = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [i + 1, { lat: 30.194 + i * 0.004, lng: -81.39 }]));
    mockTees.full = { 3: { lat: 30.40, lng: -81.70 }, 4: { lat: 30.404, lng: -81.70 } };
    _setSiblingsForTests('nine', [{ courseId: 'full', courseName: 'Full', holes: holes(18), courseLocation: null }]);
    const realNow = Date.now;
    let now = 4_000_000;
    Date.now = () => now;
    try {
      for (let t = 0; t <= DWELL_MS + 4000; t += 4000) {
        now += 4000;
        mockFix = { ...mockTees.full[3], accuracy_m: 5, speed: 0, timestamp: now, source: 'live' };
        _tickForTests();
      }
    } finally {
      Date.now = realNow;
    }
    expect(useRoundStore.getState().activeCourseId).toBe('full');
    expect(useRoundStore.getState().currentHole).toBe(3);
    expect(useRoundStore.getState().twiceAround).toBe(false);
  });
});
