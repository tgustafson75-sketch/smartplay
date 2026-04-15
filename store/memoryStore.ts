import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ShotResult = 'good' | 'miss_left' | 'miss_right';

export interface HoleMemory {
  totalShots: number;
  missesLeft: number;
  missesRight: number;
}

export interface MemoryState {
  courseMemory: Record<string, Record<number, HoleMemory>>;
  clubUsage: Record<string, number>;
  lastRoundScore: number | null;
  recordShot: (course: string, hole: number, result: ShotResult, club: string) => void;
  setLastRoundScore: (score: number) => void;
}

const defaultHoleMemory: HoleMemory = {
  totalShots: 0,
  missesLeft: 0,
  missesRight: 0,
};

export const useMemoryStore = create<MemoryState>()(
  persist(
    (set) => ({
      courseMemory: {},
      clubUsage: {},
      lastRoundScore: null,
      setLastRoundScore: (score) => set({ lastRoundScore: score }),
      recordShot: (course, hole, result, club) =>
        set((state) => {
          const courseData = state.courseMemory[course] || {};
          const prev = courseData[hole] || { ...defaultHoleMemory };
          const updated: HoleMemory = {
            totalShots: prev.totalShots + 1,
            missesLeft: prev.missesLeft + (result === 'miss_left' ? 1 : 0),
            missesRight: prev.missesRight + (result === 'miss_right' ? 1 : 0),
          };
          const clubUsage = { ...state.clubUsage };
          clubUsage[club] = (clubUsage[club] || 0) + 1;
          return {
            courseMemory: {
              ...state.courseMemory,
              [course]: {
                ...courseData,
                [hole]: updated,
              },
            },
            clubUsage,
          };
        }),
    }),
    {
      name: 'smartplay-memory',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        courseMemory: state.courseMemory,
        clubUsage: state.clubUsage,
        lastRoundScore: state.lastRoundScore,
      }),
    }
  )
);
