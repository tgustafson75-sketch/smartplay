import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getPersistStorage } from '../services/ssrSafeStorage';

// ─── TIERS ────────────────────────────────

const TIERS = [
  { min: 0,    name: 'Beginner Golfer' },
  { min: 100,  name: 'Club Player' },
  { min: 300,  name: 'Course Regular' },
  { min: 600,  name: 'Smart Golfer' },
  { min: 1000, name: 'SmartPlay Elite' },
] as const;

const getTierName = (pts: number): string =>
  [...TIERS].reverse().find(t => pts >= t.min)?.name ?? 'Beginner Golfer';

// ─── STATE ────────────────────────────────

interface PointsEntry {
  points: number;
  reason: string;
  timestamp: number;
}

interface PointsState {
  totalPoints: number;
  tier: string;
  history: PointsEntry[];

  addPoints: (pts: number, reason: string) => void;
  getTier: () => string;
}

// ─── STORE ────────────────────────────────

export const usePointsStore = create<PointsState>()(
  persist(
    (set, get) => ({
      totalPoints: 0,
      tier: 'Beginner Golfer',
      history: [],

      addPoints: (pts, reason) =>
        set(s => {
          const newTotal = s.totalPoints + pts;
          return {
            totalPoints: newTotal,
            tier: getTierName(newTotal),
            history: [
              ...s.history,
              { points: pts, reason, timestamp: Date.now() },
            ].slice(-100),
          };
        }),

      getTier: () => get().tier,
    }),
    {
      name: 'points-store-v1',
      storage: createJSONStorage(() => getPersistStorage()),
    },
  ),
);
