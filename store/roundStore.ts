import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── TYPES ────────────────────────────────

export interface CourseHole {
  hole: number;
  par: number;
  distance: number;
  front: number;
  back: number;
  teeLat: number;
  teeLng: number;
  middleLat: number;
  middleLng: number;
  frontLat: number;
  frontLng: number;
  backLat: number;
  backLng: number;
  note: string;
  estimated: boolean;
}

export interface ShotResult {
  feel: 'flush' | 'solid' | 'fat' | 'thin' | 'heel' | 'toe' | null;
  direction: 'left' | 'straight' | 'right' | null;
  shape: 'draw' | 'straight' | 'fade' | null;
  club: string | null;
  hole: number;
  timestamp: number;
  acousticContact: string | null;
}

export interface HoleStats {
  hole: number;
  score: number;
  putts: number;
  penalties: number;
  fairwayHit: boolean | null;
  girHit: boolean | null;
}

export interface RoundRecord {
  id: string;
  roundNumber: number;
  courseName: string | null;
  startedAt: number;
  endedAt: number;
  holesPlayed: number;
  totalScore: number;
  scoreVsPar: number;
  isCompetition: boolean;
  nineHoleMode: boolean;
  scores: Record<number, number>;
  putts: Record<number, number>;
}

// ─── STATE ────────────────────────────────

interface RoundState {
  isRoundActive: boolean;
  activeCourse: string | null;
  activeCourseId: string | null; // golfcourseapi course_id; null for local/manual rounds
  recentCourseIds: string[]; // last 5 API course IDs played
  courseHoles: CourseHole[];
  nineHoleMode: boolean;
  isCompetition: boolean;
  roundNotes: string;
  goal: string | null;

  currentHole: number;
  currentYardage: number | null;
  club: string | null;
  mentalState: string;
  riskMode: 'safe' | 'normal' | 'aggressive';

  scores: Record<number, number>;
  putts: Record<number, number>;
  penalties: Record<number, number>;
  shots: ShotResult[];
  holeStats: HoleStats[];

  roundStartTime: number | null;
  roundNumber: number;
  roundHistory: RoundRecord[];

  // ─── ACTIONS ────────────────────────────

  startRound: (
    course: string,
    holes: CourseHole[],
    options: {
      nineHole: boolean;
      isCompetition: boolean;
      notes: string;
      goal: string | null;
      courseId?: string | null;
    },
  ) => void;
  setActiveCourseId: (id: string | null) => void;

  endRound: () => void;
  setCurrentHole: (hole: number) => void;
  setCurrentYardage: (yards: number | null) => void;
  setClub: (club: string) => void;
  setMentalState: (state: string) => void;
  setRiskMode: (mode: 'safe' | 'normal' | 'aggressive') => void;
  logScore: (hole: number, score: number) => void;
  logPutts: (hole: number, putts: number) => void;
  addPenalty: (hole: number) => void;
  logShot: (shot: ShotResult) => void;
  setRoundNotes: (notes: string) => void;
  setNineHoleMode: (v: boolean) => void;
  setIsCompetition: (v: boolean) => void;

  getCurrentPar: () => number | null;
  getTotalScore: () => number;
  getHolesPlayed: () => number;
  getScoreVsPar: () => number;
  getCurrentHoleData: () => CourseHole | null;
}

// ─── STORE ────────────────────────────────

export const useRoundStore = create<RoundState>()(
  persist(
    (set, get) => ({
      isRoundActive: false,
      activeCourse: null,
      activeCourseId: null,
      recentCourseIds: [],
      courseHoles: [],
      nineHoleMode: false,
      isCompetition: false,
      roundNotes: '',
      goal: null,
      currentHole: 1,
      currentYardage: null,
      club: null,
      mentalState: 'neutral',
      riskMode: 'normal',
      scores: {},
      putts: {},
      penalties: {},
      shots: [],
      holeStats: [],
      roundStartTime: null,
      roundNumber: 0,
      roundHistory: [],

      startRound: (course, holes, options) => {
        const courseId = options.courseId ?? null;
        const prev = get();
        const updatedRecent = courseId
          ? [courseId, ...prev.recentCourseIds.filter(id => id !== courseId)].slice(0, 5)
          : prev.recentCourseIds;
        set({
          isRoundActive: true,
          activeCourse: course,
          activeCourseId: courseId,
          recentCourseIds: updatedRecent,
          courseHoles: holes,
          nineHoleMode: options.nineHole,
          isCompetition: options.isCompetition,
          roundNotes: options.notes,
          goal: options.goal,
          currentHole: 1,
          currentYardage: holes[0]?.distance ?? null,
          scores: {},
          putts: {},
          penalties: {},
          shots: [],
          holeStats: [],
          roundStartTime: Date.now(),
          roundNumber: prev.roundNumber + 1,
        });
      },

      setActiveCourseId: (id) => set({ activeCourseId: id }),

      endRound: () => {
        const s = get();
        let scoreVsPar = 0;
        for (const [holeNum, score] of Object.entries(s.scores)) {
          const par = s.courseHoles.find(h => h.hole === Number(holeNum))?.par ?? 0;
          scoreVsPar += score - par;
        }
        const record: RoundRecord = {
          id: Date.now().toString(),
          roundNumber: s.roundNumber,
          courseName: s.activeCourse,
          startedAt: s.roundStartTime ?? Date.now(),
          endedAt: Date.now(),
          holesPlayed: Object.keys(s.scores).length,
          totalScore: Object.values(s.scores).reduce((a, b) => a + b, 0),
          scoreVsPar,
          isCompetition: s.isCompetition,
          nineHoleMode: s.nineHoleMode,
          scores: { ...s.scores },
          putts: { ...s.putts },
        };
        set(state => ({
          isRoundActive: false,
          roundHistory: [...state.roundHistory, record],
        }));
      },

      setCurrentHole: (hole) => {
        const holeData = get().courseHoles.find(h => h.hole === hole);
        set({ currentHole: hole, currentYardage: holeData?.distance ?? null });
      },

      setCurrentYardage: (yards) => set({ currentYardage: yards }),
      setClub: (club) => set({ club }),
      setMentalState: (state) => set({ mentalState: state }),
      setRiskMode: (mode) => set({ riskMode: mode }),

      logScore: (hole, score) =>
        set(s => ({ scores: { ...s.scores, [hole]: score } })),

      logPutts: (hole, putts) =>
        set(s => ({ putts: { ...s.putts, [hole]: putts } })),

      addPenalty: (hole) =>
        set(s => ({
          penalties: { ...s.penalties, [hole]: (s.penalties[hole] ?? 0) + 1 },
        })),

      logShot: (shot) =>
        set(s => ({ shots: [...s.shots, shot] })),

      setRoundNotes: (notes) => set({ roundNotes: notes }),
      setNineHoleMode: (v) => set({ nineHoleMode: v }),
      setIsCompetition: (v) => set({ isCompetition: v }),

      getCurrentPar: () => {
        const { courseHoles, currentHole } = get();
        return courseHoles.find(h => h.hole === currentHole)?.par ?? null;
      },

      getTotalScore: () =>
        Object.values(get().scores).reduce((a, b) => a + b, 0),

      getHolesPlayed: () =>
        Object.keys(get().scores).length,

      getScoreVsPar: () => {
        const { scores, courseHoles } = get();
        let total = 0;
        let par = 0;
        for (const [holeNum, score] of Object.entries(scores)) {
          if (score > 0) {
            total += score;
            par += courseHoles.find(h => h.hole === Number(holeNum))?.par ?? 0;
          }
        }
        return total - par;
      },

      getCurrentHoleData: () => {
        const { courseHoles, currentHole } = get();
        return courseHoles.find(h => h.hole === currentHole) ?? null;
      },
    }),
    {
      name: 'round-store-v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({
        isRoundActive: s.isRoundActive,
        activeCourse: s.activeCourse,
        activeCourseId: s.activeCourseId,
        recentCourseIds: s.recentCourseIds,
        courseHoles: s.courseHoles,
        nineHoleMode: s.nineHoleMode,
        isCompetition: s.isCompetition,
        roundNotes: s.roundNotes,
        goal: s.goal,
        currentHole: s.currentHole,
        currentYardage: s.currentYardage,
        club: s.club,
        scores: s.scores,
        putts: s.putts,
        penalties: s.penalties,
        shots: s.shots,
        holeStats: s.holeStats,
        roundNumber: s.roundNumber,
        roundHistory: s.roundHistory,
      }),
    },
  ),
);
