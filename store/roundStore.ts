import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ShotResult = 'left' | 'right' | 'center' | 'short' | 'long';

export type Shot = {
  result: ShotResult;
  mental: string;
  club: string;
  aim: string;
  target?: 'left' | 'center' | 'right';  // intended aim before the shot
  timestamp: number;
  hole: number;
  distance: number;
  situation?: string;
  // GPS-enriched fields — populated when GPS watch is active
  gpsLat?: number;
  gpsLng?: number;
  yardsBefore?: number;   // distance-to-pin at moment of shot
  yardsAfter?: number;    // distance-to-pin after player walks to ball
  yardsCarried?: number;  // computed: yardsBefore - yardsAfter
  // AI / video frame analysis fields
  sessionId?: string;     // groups shots within a round session; set once per session start
  frameTag?: string;      // media-fragment ref to the video frame (e.g. "<uri>#t=12s")
  // Shot Intelligence — manual correction layer
  gpsDistance?: number | null;         // raw GPS distance at shot time
  adjustedDistance?: number | null;    // gpsDistance + distanceOffset
  distanceOffset?: number;             // yards user corrected (negative = came up short)
  directionOffset?: 'left' | 'center' | 'right' | null; // user-corrected actual direction
  // Shot source — distinguishes user-logged vs auto-detected shots
  source?: 'manual' | 'auto';
};

export type HoleEntry = { hole: number; par: number; scores: number[] };

// ── Unified scoring grid ──────────────────────────────────────────────────
// gridScores[playerIdx][holeIdx 0..17] — single source of truth for all UIs.
// Synced to courseScores[courseId] so switching courses restores the right set.
export const EMPTY_GRID = (): number[][] =>
  Array.from({ length: 4 }, () => Array(18).fill(0));

interface RoundState {
  scores: number[];
  currentHole: number;
  currentPar: number;
  goal: 'break100' | 'break90' | null;
  goalMode: 'beginner' | 'break90' | 'break80';
  strategyMode: 'safe' | 'neutral' | 'attack';
  isRoundActive: boolean;
  club: string;
  targetDistance: number | null;
  shots: Shot[];
  shotResult: string;
  aim: string;
  activeCourse: string;
  selectedCourseIdx: number;
  setSelectedCourseIdx: (idx: number) => void;
  // ── Unified scoring grid (single source of truth) ──────────────────────
  /** gridScores[playerIdx][holeIdx 0..17] */
  gridScores: number[][];
  /** Display names for up to 4 players */
  gridPlayerNames: string[];
  /** Scores persisted per courseId so switching courses doesn't wipe data */
  courseScores: Record<string, number[][]>;
  /** Write one hole score — updates gridScores, scores[], and courseScores snapshot */
  setCourseHoleScore: (playerIdx: number, holeIdx: number, score: number, courseId?: string) => void;
  /** Set a player display name */
  setGridPlayerName: (playerIdx: number, name: string) => void;
  /** Load the grid for a given courseId (call when course changes) */
  loadCourseScores: (courseId: string) => void;
  // Multi-player
  players: string[];
  activePlayerCount: number;
  multiRound: HoleEntry[];
  setScore: (holeIndex: number, value: number) => void;
  setCurrentHole: (hole: number) => void;
  setCurrentPar: (par: number) => void;
  setGoal: (goal: 'break100' | 'break90') => void;
  setGoalMode: (mode: 'beginner' | 'break90' | 'break80') => void;
  setStrategyMode: (mode: 'safe' | 'neutral' | 'attack') => void;
  setIsRoundActive: (active: boolean) => void;
  setClub: (club: string) => void;
  setTargetDistance: (dist: number | null) => void;
  addShot: (shot: Shot) => void;
  adjustLastShot: (correction: { distanceOffset: number; directionOffset: 'left' | 'center' | 'right' }) => void;
  /** Attach a video/media URI to the most recently logged shot as a frameTag. */
  tagLastShotMedia: (uri: string) => void;
  clearRound: () => void;
  setShotResult: (r: string) => void;
  setAim: (a: string) => void;
  setActiveCourse: (name: string) => void;
  setPlayers: (players: string[]) => void;
  setActivePlayerCount: (count: number) => void;
  setMultiRound: (entries: HoleEntry[]) => void;
  addMultiRoundHole: (entry: HoleEntry) => void;
  // ── New fields ──────────────────────────────────────────────────────────
  nineHoleMode: boolean;
  isCompetition: boolean;
  roundNotes: string;
  penaltyLog: { hole: number; strokes: number; reason: string; timestamp: number }[];
  /** Putts logged per hole — index 0–17 maps to holes 1–18 */
  holePutts: number[];
  setNineHoleMode: (enabled: boolean) => void;
  setIsCompetition: (enabled: boolean) => void;
  setRoundNotes: (text: string) => void;
  addPenalty: (entry: { hole: number; strokes: number; reason: string }) => void;
  clearPenalties: () => void;
  setPuttForHole: (holeIdx: number, putts: number) => void;
}

export const useRoundStore = create<RoundState>()(
  persist(
    (set) => ({
  scores: Array(18).fill(0),
  currentHole: 1,
  currentPar: 4,
  goal: null,
  goalMode: 'beginner',
  strategyMode: 'neutral',
  isRoundActive: false,
  club: 'Driver',
  targetDistance: null,
  shots: [],
  shotResult: '',
  aim: 'center',
  activeCourse: 'Menifee Lakes – Palms',
  selectedCourseIdx: 0,
  gridScores: EMPTY_GRID(),
  gridPlayerNames: ['You', 'Player 2', 'Player 3', 'Player 4'],
  courseScores: {},
  players: ['You'],
  activePlayerCount: 1,
  multiRound: [],
  nineHoleMode: false,
  isCompetition: false,
  roundNotes: '',
  penaltyLog: [],
  holePutts: Array(18).fill(0),
  setScore: (holeIndex, value) =>
    set((state) => {
      const scores = [...state.scores];
      scores[holeIndex] = value;
      return { scores };
    }),
  setCurrentHole: (hole) => set(() => ({ currentHole: hole })),
  setCurrentPar: (par) => set(() => ({ currentPar: par })),
  setGoal: (goal) => set(() => ({ goal })),
  setGoalMode: (goalMode) => set(() => ({ goalMode })),
  setStrategyMode: (strategyMode) => set(() => ({ strategyMode })),
  setIsRoundActive: (isRoundActive) => set(() => ({ isRoundActive })),
  setClub: (club) => set(() => ({ club })),
  setTargetDistance: (dist) => set(() => ({ targetDistance: dist })),
  addShot: (shot) => set((state) => ({ shots: [...state.shots, shot].slice(-250), shotResult: shot.result })),
  adjustLastShot: (correction) =>
    set((state) => {
      if (state.shots.length === 0) return {};
      const shots = [...state.shots];
      const last = { ...shots?.[shots.length - 1] };
      const offset = correction.distanceOffset ?? 0;
      last.distanceOffset = offset;
      last.directionOffset = correction.directionOffset;
      last.adjustedDistance = last.gpsDistance != null ? last.gpsDistance + offset : null;
      shots[shots.length - 1] = last;
      return { shots };
    }),
  tagLastShotMedia: (uri) =>
    set((state) => {
      if (state.shots.length === 0) return {};
      const shots = [...state.shots];
      shots[shots.length - 1] = { ...shots[shots.length - 1], frameTag: uri };
      return { shots };
    }),
  /**
   * Reset every gameplay field that should NOT carry between rounds.
   * Note: courseScores is intentionally preserved — it is the per-course
   * scorecard archive used to restore prior scores when the user reselects
   * that course. Live scoring state (gridScores, scores, holePutts, penaltyLog,
   * shots, currentHole, currentPar) is wiped.
   */
  clearRound: () => set(() => ({
    shots:        [],
    shotResult:   '',
    aim:          'center',
    multiRound:   [],
    holePutts:    Array(18).fill(0),
    scores:       Array(18).fill(0),
    gridScores:   EMPTY_GRID(),
    penaltyLog:   [],
    currentHole:  1,
    currentPar:   4,
  })),
  setPuttForHole: (holeIdx, putts) =>
    set((state) => {
      const h = [...state.holePutts];
      h[holeIdx] = putts;
      return { holePutts: h };
    }),
  setShotResult: (r) => set(() => ({ shotResult: r })),
  setAim: (a) => set(() => ({ aim: a })),
  setActiveCourse: (name) => set(() => ({ activeCourse: name })),
  setSelectedCourseIdx: (idx) => set(() => ({ selectedCourseIdx: idx })),
  setCourseHoleScore: (playerIdx, holeIdx, score, courseId) =>
    set((state) => {
      const grid = state.gridScores.map((row) => [...row]);
      // Defensive: a persisted snapshot from a prior schema may not include
      // a row for this playerIdx — fill in an empty 18-hole row before writing.
      if (!grid[playerIdx]) grid[playerIdx] = Array(18).fill(0);
      grid[playerIdx][holeIdx] = score;
      // Keep legacy flat scores[] in sync for player 0
      const scores = playerIdx === 0 ? [...state.scores] : state.scores;
      if (playerIdx === 0) scores[holeIdx] = score;
      // Persist to courseScores
      const id = courseId ?? state.activeCourse;
      const courseScores = { ...state.courseScores, [id]: grid.map((r) => [...r]) };
      return { gridScores: grid, scores, courseScores };
    }),
  setGridPlayerName: (playerIdx, name) =>
    set((state) => {
      const n = [...state.gridPlayerNames];
      n[playerIdx] = name;
      return { gridPlayerNames: n };
    }),
  loadCourseScores: (courseId) =>
    set((state) => {
      const saved = state.courseScores[courseId];
      const gridScores = saved ? saved.map((r) => [...r]) : EMPTY_GRID();
      return { gridScores };
    }),
  setPlayers: (players) => set(() => ({ players })),
  setActivePlayerCount: (activePlayerCount) => set(() => ({ activePlayerCount })),
  setMultiRound: (multiRound) => set(() => ({ multiRound })),
  addMultiRoundHole: (entry) => set((state) => {
    const existing = state.multiRound.findIndex((h) => h.hole === entry.hole);
    if (existing >= 0) {
      const updated = [...state.multiRound];
      updated[existing] = entry;
      return { multiRound: updated };
    }
    return { multiRound: [...state.multiRound, entry] };
  }),
  setNineHoleMode: (nineHoleMode) => set(() => ({ nineHoleMode })),
  setIsCompetition: (isCompetition) => set(() => ({ isCompetition })),
  setRoundNotes: (roundNotes) => set(() => ({ roundNotes })),
  addPenalty: (entry) =>
    set((state) => ({
      penaltyLog: [...state.penaltyLog, { ...entry, timestamp: Date.now() }],
    })),
  clearPenalties: () => set(() => ({ penaltyLog: [] })),
}),
    {
      name: 'round-store-v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        scores: state.scores,
        currentHole: state.currentHole,
        currentPar: state.currentPar,
        goal: state.goal,
        goalMode: state.goalMode,
        strategyMode: state.strategyMode,
        isRoundActive: state.isRoundActive,
        club: state.club,
        shots: state.shots,
        shotResult: state.shotResult,
        aim: state.aim,
        activeCourse: state.activeCourse,
        selectedCourseIdx: state.selectedCourseIdx,
        gridScores: state.gridScores,
        gridPlayerNames: state.gridPlayerNames,
        courseScores: state.courseScores,
        players: state.players,
        activePlayerCount: state.activePlayerCount,
        multiRound: state.multiRound,
        nineHoleMode: state.nineHoleMode,
        isCompetition: state.isCompetition,
        roundNotes: state.roundNotes,
        penaltyLog: state.penaltyLog,
        holePutts: state.holePutts,
      }),
    }
  )
);
