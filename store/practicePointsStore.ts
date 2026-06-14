import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getPersistStorage } from '../services/ssrSafeStorage';

/**
 * 2026-06-13 — Practice Points (Tim).
 *
 * A CONSERVATIVE points system that rewards completed drill sessions, surfaced on
 * the dashboard. No socials, no inflation — modest points so the number stays
 * honest. Each completed drill (a captureKind:'drill' session, 3–5 swings) is a
 * countable, attributable event, so this is the natural hook (see
 * drill-ai-analysis-and-points). The real intent is the DATA: correlating practice
 * volume against on-course improvement over time — this store is the practice side
 * of that ledger.
 *
 * Conservative scheme: a small base for completing a drill + 1/swing, capped. So a
 * full 5-swing drill = 10, a 3-swing = 8. Persisted so it accumulates.
 */

const BASE_PER_DRILL = 5;
const PER_SWING = 1;
const MAX_SWINGS_COUNTED = 5; // keep it conservative — no farming

export interface DrillPointRecord {
  points: number;
  sessions: number;
  lastAt: number;
}

interface PracticePointsState {
  total: number;
  /** Points per drill id (e.g. 'tempo_consistency', 'early_extension'). */
  byDrill: Record<string, DrillPointRecord>;
  /** Award a completed drill session. Returns the points granted. */
  awardDrill: (drillId: string, swings: number, now: number) => number;
  reset: () => void;
}

export const usePracticePointsStore = create<PracticePointsState>()(
  persist(
    (set, get) => ({
      total: 0,
      byDrill: {},
      awardDrill: (drillId, swings, now) => {
        const counted = Math.max(0, Math.min(MAX_SWINGS_COUNTED, Math.round(swings)));
        const granted = BASE_PER_DRILL + counted * PER_SWING;
        const prev = get().byDrill[drillId] ?? { points: 0, sessions: 0, lastAt: 0 };
        set((s) => ({
          total: s.total + granted,
          byDrill: {
            ...s.byDrill,
            [drillId]: { points: prev.points + granted, sessions: prev.sessions + 1, lastAt: now },
          },
        }));
        return granted;
      },
      reset: () => set({ total: 0, byDrill: {} }),
    }),
    {
      name: 'practice-points',
      storage: createJSONStorage(() => getPersistStorage()),
      // 2026-06-14 (audit — store hygiene) — explicit version + passthrough migrate
      // so a future shape bump upgrades cleanly instead of wiping persisted state.
      version: 1,
      migrate: (s) => s as never,
    },
  ),
);
