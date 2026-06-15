/**
 * 2026-06-13 — Tee-box score goals store (the round-side challenge ledger).
 *
 * Holds the player's active "break X from the Y tees" goals. Evaluation is pure
 * (services/goals/teeScoreGoal.evaluateTeeGoal) against roundStore history — this
 * store just persists the goal definitions. See memory: tee-box-score-goals.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getPersistStorage } from '../services/ssrSafeStorage';
import type { TeeScoreGoal } from '../services/goals/teeScoreGoal';

interface TeeGoalState {
  goals: TeeScoreGoal[];
  addGoal: (goal: Omit<TeeScoreGoal, 'id' | 'createdAt'>, id: string, createdAt: number) => void;
  removeGoal: (id: string) => void;
  clearAll: () => void;
}

export const useTeeGoalStore = create<TeeGoalState>()(
  persist(
    (set) => ({
      goals: [],
      addGoal: (goal, id, createdAt) =>
        set((s) => ({ goals: [...s.goals, { ...goal, id, createdAt }] })),
      removeGoal: (id) => set((s) => ({ goals: s.goals.filter((g) => g.id !== id) })),
      clearAll: () => set({ goals: [] }),
    }),
    {
      name: 'tee-goals-v1',
      version: 1,
      migrate: (s) => s as never, // 2026-06-15 (audit) — passthrough; no silent wipe on bump
      storage: createJSONStorage(() => getPersistStorage()),
    },
  ),
);
