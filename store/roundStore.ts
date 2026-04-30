import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { RoundMode } from '../types/patterns';
import type { HolePlan } from '../types/plan';
import type { ShotOutcome } from '../types/shot';
import type { RulesDecision } from '../types/penalty';

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
  id?: string;
  feel: 'flush' | 'solid' | 'fat' | 'thin' | 'heel' | 'toe' | null;
  direction: 'left' | 'straight' | 'right' | null;
  shape: 'draw' | 'straight' | 'fade' | null;
  club: string | null;
  hole: number;
  timestamp: number;
  acousticContact: string | null;
  // Outcome tagging (added v1 migration — absent in old data treated as 'clean')
  outcome?: ShotOutcome;
  penalty_strokes?: number;
  rules_decision?: RulesDecision;
  // Phase A.2 — conversational logging fields. All optional for back-compat.
  distance_yards?: number | null;
  raw_utterance?: string;
  logged_via?: 'voice' | 'tap';
  gps_location?: { lat: number; lng: number } | null;
  shot_in_round_index?: number;
  player_id?: string;        // reserved for Phase 1.1 multi-player
  speaker_id?: string;       // reserved for Phase 1.1 multi-player voice ID
  weather_snapshot?: Record<string, unknown> | null;  // populated by Phase C
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
  courseId: string | null;
  startedAt: number;
  endedAt: number;
  holesPlayed: number;
  totalScore: number;
  scoreVsPar: number;
  isCompetition: boolean;
  nineHoleMode: boolean;
  mode: RoundMode;
  scores: Record<number, number>;
  putts: Record<number, number>;
  plans: HolePlan[];
  shots: ShotResult[];
}

// ─── STATE ────────────────────────────────

interface RoundState {
  isRoundActive: boolean;
  mode: RoundMode;
  currentRoundId: string | null;
  plans: HolePlan[];
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
  active_ghost: { source_round_id: string; label: string } | null;

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
      mode?: RoundMode;
    },
  ) => void;
  setActiveCourseId: (id: string | null) => void;
  setCurrentRoundMode: (mode: RoundMode) => void;
  addOrUpdatePlan: (partial: {
    hole_number: number;
    markers: HolePlan['markers'];
    computed_yardages: HolePlan['computed_yardages'];
  }) => void;
  lockPlanForHole: (holeNumber: number) => void;
  getPlanForHole: (holeNumber: number) => HolePlan | null;

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

  setActiveGhost: (payload: { source_round_id: string; label: string } | null) => void;
  clearActiveGhost: () => void;

  getCurrentPar: () => number | null;
  getTotalScore: () => number;
  getHolesPlayed: () => number;
  getScoreVsPar: () => number;
  getCurrentHoleData: () => CourseHole | null;
  computeHoleScore: (hole: number) => number | null;
}

// ─── STORE ────────────────────────────────

export const useRoundStore = create<RoundState>()(
  persist(
    (set, get) => ({
      isRoundActive: false,
      mode: 'free_play' as RoundMode,
      currentRoundId: null,
      plans: [],
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
      active_ghost: null,

      startRound: (course, holes, options) => {
        const courseId = options.courseId ?? null;
        const prev = get();
        const updatedRecent = courseId
          ? [courseId, ...prev.recentCourseIds.filter(id => id !== courseId)].slice(0, 5)
          : prev.recentCourseIds;
        const roundId = Date.now().toString();
        set({
          isRoundActive: true,
          mode: options.mode ?? 'free_play',
          currentRoundId: roundId,
          plans: [],
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
          active_ghost: null,
        });
      },

      setActiveCourseId: (id) => set({ activeCourseId: id }),
      setCurrentRoundMode: (mode) => set({ mode }),

      addOrUpdatePlan: (partial) => {
        const state = get();
        const existing = state.plans.find(p => p.hole_number === partial.hole_number);
        if (existing) {
          set(s => ({
            plans: s.plans.map(p =>
              p.hole_number === partial.hole_number
                ? { ...p, markers: partial.markers, computed_yardages: partial.computed_yardages }
                : p
            ),
          }));
        } else {
          const newPlan: HolePlan = {
            id: Date.now().toString() + '_h' + partial.hole_number,
            round_id: state.currentRoundId ?? 'unknown',
            course_id: state.activeCourseId ?? 'local',
            hole_number: partial.hole_number,
            player_id: 'primary',
            created_at: Date.now(),
            locked_at: null,
            notes: null,
            markers: partial.markers,
            computed_yardages: partial.computed_yardages,
          };
          set(s => ({ plans: [...s.plans, newPlan] }));
        }
      },

      lockPlanForHole: (holeNumber) =>
        set(s => ({
          plans: s.plans.map(p =>
            p.hole_number === holeNumber && p.locked_at === null
              ? { ...p, locked_at: Date.now() }
              : p
          ),
        })),

      getPlanForHole: (holeNumber) =>
        get().plans.find(p => p.hole_number === holeNumber) ?? null,

      endRound: () => {
        const s = get();
        let scoreVsPar = 0;
        for (const [holeNum, score] of Object.entries(s.scores)) {
          const par = s.courseHoles.find(h => h.hole === Number(holeNum))?.par ?? 0;
          scoreVsPar += score - par;
        }
        const record: RoundRecord = {
          id: s.currentRoundId ?? Date.now().toString(),
          roundNumber: s.roundNumber,
          courseName: s.activeCourse,
          courseId: s.activeCourseId,
          startedAt: s.roundStartTime ?? Date.now(),
          endedAt: Date.now(),
          holesPlayed: Object.keys(s.scores).length,
          totalScore: Object.values(s.scores).reduce((a, b) => a + b, 0),
          scoreVsPar,
          isCompetition: s.isCompetition,
          nineHoleMode: s.nineHoleMode,
          mode: s.mode,
          scores: { ...s.scores },
          putts: { ...s.putts },
          plans: [...s.plans],
          shots: [...s.shots],
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

      addPenalty: (hole) => {
        // Unified path: creates a ShotResult so the penalty flows through computeHoleScore,
        // pattern detection, and recap — same as all other penalty outcomes.
        const syntheticShot: ShotResult = {
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          feel: null,
          direction: null,
          shape: null,
          club: null,
          hole,
          timestamp: Date.now(),
          acousticContact: null,
          outcome: 'manual_penalty',
          penalty_strokes: 1,
          rules_decision: undefined,
        };
        get().logShot(syntheticShot);
        // Bump scores[hole] by 1 so the scorecard reflects this penalty immediately.
        const currentScore = get().scores[hole] ?? 0;
        get().logScore(hole, currentScore + 1);
        // Legacy penalties[] field intentionally NOT written — ShotResult is authoritative now.
      },

      logShot: (shot) =>
        set(s => ({ shots: [...s.shots, shot] })),

      setRoundNotes: (notes) => set({ roundNotes: notes }),
      setNineHoleMode: (v) => set({ nineHoleMode: v }),
      setIsCompetition: (v) => set({ isCompetition: v }),
      setActiveGhost: (payload) => set({ active_ghost: payload }),
      clearActiveGhost: () => set({ active_ghost: null }),

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

      computeHoleScore: (hole: number) => {
        const holeShots = get().shots.filter(s => s.hole === hole);
        if (holeShots.length === 0) return null;
        return holeShots.length + holeShots.reduce((acc, s) => acc + (s.penalty_strokes ?? 0), 0);
      },
    }),
    {
      name: 'round-store-v1',
      version: 1,
      migrate: (persisted, version) => {
        const s = persisted as RoundState;
        if (version === 0) {
          s.shots = (s.shots ?? []).map(sh => ({
            ...sh,
            outcome: sh.outcome ?? 'clean',
            penalty_strokes: sh.penalty_strokes ?? 0,
          }));
          s.roundHistory = (s.roundHistory ?? []).map(r => ({
            ...r,
            shots: (r.shots ?? []).map(sh => ({
              ...sh,
              outcome: sh.outcome ?? 'clean',
              penalty_strokes: sh.penalty_strokes ?? 0,
            })),
          }));
        }
        return s;
      },
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({
        isRoundActive: s.isRoundActive,
        mode: s.mode,
        currentRoundId: s.currentRoundId,
        plans: s.plans,
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
        active_ghost: s.active_ghost,
      }),
    },
  ),
);
