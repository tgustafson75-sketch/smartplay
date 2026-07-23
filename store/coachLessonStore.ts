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

const MAX = 30;

interface CoachLessonState {
  lessons: LessonRecord[];
  record: (r: Omit<LessonRecord, 'at'>, nowMs: number) => void;
  lastFor: (faultId: string) => LessonRecord | null;
  lastLesson: () => LessonRecord | null;
  clear: () => void;
}

export const useCoachLessonStore = create<CoachLessonState>()(
  persist(
    (set, get) => ({
      lessons: [],
      record: (r, nowMs) =>
        set((s) => ({ lessons: [{ ...r, at: nowMs }, ...s.lessons].slice(0, MAX) })),
      lastFor: (faultId) => get().lessons.find((l) => l.faultId === faultId) ?? null,
      lastLesson: () => get().lessons[0] ?? null,
      clear: () => set({ lessons: [] }),
    }),
    {
      name: 'coach-lesson-history-v1',
      storage: createJSONStorage(() => getPersistStorage()),
    },
  ),
);
