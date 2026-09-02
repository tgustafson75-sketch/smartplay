/**
 * 2026-07-23 (Tim — elite Coach Caddie). A tiny persisted memory of past lessons so the caddie
 * behaves like a coach who KNOWS you: it remembers the last thing you worked on and can note
 * whether it stuck. Stored on-device (AsyncStorage via the shared persist adapter). Small + bounded.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getPersistStorage } from '../services/ssrSafeStorage';

export interface LessonRecord {
  at: number;              // epoch ms
  faultId: string;
  faultName: string;
  hitCheckpoint: boolean;  // did they reach the checkpoint on this priority?
}

/**
 * 2026-09-01 (Tim — "make sure that those lessons have a store, not the swing library, probably more
 * appropriate card in the dashboard") — A COMPLETED SESSION WAS LEAVING NO TRACE.
 *
 * `record()` above is written from ONE place: the diagnosis path, when a priority fault reaches its
 * checkpoint. The GUIDED PLANS — Full swing tune-up, More power, Better contact — and the single
 * focus sessions wrote nothing at all. A player could finish a three-focus lesson, be told "nice
 * session, take those feels to the course", and the app would hold no memory that it happened.
 *
 * That is a hole in the loop rather than a missing screen. A coach who does not remember last week's
 * lesson is not a coach, and this store exists precisely so the caddie "behaves like a coach who
 * KNOWS you". [[close-the-loop-strategy]] [[caddie-cns]]
 *
 * Kept HERE and not in the swing library, per Tim: the library holds CLIPS, one row per swing. A
 * lesson is a session — a plan, its focuses, how many reps, what was worked. Filing it as swings
 * would bury it among every practice ball ever hit and lose the shape of the lesson entirely.
 */
export interface SessionRecord {
  at: number;                 // epoch ms
  /** LESSON_PLANS id for a guided plan, or null for a single-focus session. */
  planId: string | null;
  /** What to call it on a card: the plan label, or the focus label. */
  label: string;
  /** Focus ids worked, in the order they were taught. */
  focusIds: string[];
  /** Swings actually read during the session — reps that produced a verdict, not reps attempted. */
  repsRead: number;
  /** Reps whose verdict was 'good'. Honest: absent metrics never count as good. */
  repsGood: number;
  /** True when the session ran to the end of its plan rather than being ended early. */
  completed: boolean;
}

const MAX = 30;

interface CoachLessonState {
  lessons: LessonRecord[];
  /** Completed lesson SESSIONS (guided plans + single focuses). See SessionRecord. */
  sessions: SessionRecord[];
  record: (r: Omit<LessonRecord, 'at'>, nowMs: number) => void;
  recordSession: (r: Omit<SessionRecord, 'at'>, nowMs: number) => void;
  lastFor: (faultId: string) => LessonRecord | null;
  lastLesson: () => LessonRecord | null;
  lastSession: () => SessionRecord | null;
  /** Sessions in the last `days` days — what a dashboard card counts. */
  sessionsSince: (sinceMs: number) => SessionRecord[];
  clear: () => void;
}

export const useCoachLessonStore = create<CoachLessonState>()(
  persist(
    (set, get) => ({
      lessons: [],
      sessions: [],
      record: (r, nowMs) =>
        set((s) => ({ lessons: [{ ...r, at: nowMs }, ...s.lessons].slice(0, MAX) })),
      recordSession: (r, nowMs) =>
        set((s) => ({ sessions: [{ ...r, at: nowMs }, ...s.sessions].slice(0, MAX) })),
      lastFor: (faultId) => get().lessons.find((l) => l.faultId === faultId) ?? null,
      lastLesson: () => get().lessons[0] ?? null,
      lastSession: () => get().sessions[0] ?? null,
      sessionsSince: (sinceMs) => get().sessions.filter((x) => x.at >= sinceMs),
      clear: () => set({ lessons: [], sessions: [] }),
    }),
    {
      name: 'coach-lesson-history-v1',
      storage: createJSONStorage(() => getPersistStorage()),
      /**
       * 2026-09-01 — v1 -> v2 adds `sessions`. The KEY IS UNCHANGED on purpose: renaming it would
       * abandon every lesson already recorded on a tester's device. A persisted state from v1 has no
       * `sessions` array at all, and a store method reading `.filter` off undefined would crash the
       * dashboard card on first launch after the update, so the migration MATERIALISES it.
       * [[nobody-chose-cage-the-default-did]] — a rename must carry the value.
       */
      version: 2,
      migrate: (persisted, from) => {
        const st = (persisted ?? {}) as Partial<CoachLessonState>;
        if (from < 2 || !Array.isArray(st.sessions)) return { ...st, sessions: [] } as CoachLessonState;
        return st as CoachLessonState;
      },
    },
  ),
);
