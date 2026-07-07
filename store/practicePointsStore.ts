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
// 2026-07-06 (Tim — pro-video → drill loop moat) — a small, ONE-TIME reward for
// watching a pro drill video all the way through (a real learning action). One-time
// so re-watching can't farm points; modest so the number stays honest.
const WATCH_POINTS = 5;

export interface DrillPointRecord {
  points: number;
  sessions: number;
  lastAt: number;
  /** 2026-06-14 — display label for non-drill keys (focus/open-range), so the
   *  dashboard can render them without a drill-catalog lookup. */
  label?: string;
}

interface PracticePointsState {
  total: number;
  /** Points per practice key — a drill id ('tempo_consistency'), a focus
   *  ('focus:irons'), or 'open_range'. */
  byDrill: Record<string, DrillPointRecord>;
  /** 2026-07-06 — drill-video keys that have already been rewarded for a full
   *  watch, so the one-time watch points can't be farmed by re-watching. */
  watchedVideos: Record<string, number>;
  /**
   * 2026-07-06 (pro-video → drill loop) — award the one-time full-watch points for
   * a drill video. No-ops (returns 0) if this drill's video was already rewarded.
   * Also feeds the visible tiered points. Returns points granted (0 if repeat).
   */
  awardVideoWatch: (drillId: string, label: string | null, now: number) => number;
  /**
   * 2026-06-14 (Tim — wire the points) — the unified practice award. Records the
   * per-key practice ledger AND feeds the visible tiered pointsStore so ALL
   * practice (drills + Open Range + Focus + SmartPlan) counts toward the user's
   * level — not just the Drills-screen path. Returns points granted.
   */
  awardPracticePoints: (input: { key: string; label?: string | null; swings: number; now: number }) => number;
  /** Back-compat thin wrapper for the drill flow (keys by drillId). */
  awardDrill: (drillId: string, swings: number, now: number) => number;
  reset: () => void;
}

export const usePracticePointsStore = create<PracticePointsState>()(
  persist(
    (set, get) => ({
      total: 0,
      byDrill: {},
      watchedVideos: {},
      awardVideoWatch: (drillId, label, now) => {
        if (!drillId) return 0;
        const key = `watch:${drillId}`;
        if (get().watchedVideos[key]) return 0; // already rewarded — no farming
        set((s) => ({
          total: s.total + WATCH_POINTS,
          watchedVideos: { ...s.watchedVideos, [key]: now },
          byDrill: {
            ...s.byDrill,
            [key]: {
              points: (s.byDrill[key]?.points ?? 0) + WATCH_POINTS,
              sessions: (s.byDrill[key]?.sessions ?? 0) + 1,
              lastAt: now,
              label: label && label.trim() ? `Watched: ${label.trim()}` : 'Watched a drill video',
            },
          },
        }));
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const pts = require('./pointsStore') as typeof import('./pointsStore');
          pts.usePointsStore.getState().addPoints(WATCH_POINTS, label ? `Watched: ${label}` : 'Watched a drill video');
        } catch { /* tier feed best-effort */ }
        return WATCH_POINTS;
      },
      awardPracticePoints: ({ key, label, swings, now }) => {
        if (!key) return 0;
        const counted = Math.max(0, Math.min(MAX_SWINGS_COUNTED, Math.round(swings)));
        const granted = BASE_PER_DRILL + counted * PER_SWING;
        const prev = get().byDrill[key] ?? { points: 0, sessions: 0, lastAt: 0 };
        set((s) => ({
          total: s.total + granted,
          byDrill: {
            ...s.byDrill,
            [key]: {
              points: prev.points + granted,
              sessions: prev.sessions + 1,
              lastAt: now,
              label: (label && label.trim()) ? label.trim() : prev.label,
            },
          },
        }));
        // Unify: practice also feeds the visible tiered points (gamification),
        // so the user's level reflects practice, not just rounds/cage/caddie.
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const pts = require('./pointsStore') as typeof import('./pointsStore');
          pts.usePointsStore.getState().addPoints(granted, label ? `Practice: ${label}` : 'Practice session');
        } catch { /* tier feed best-effort */ }
        return granted;
      },
      awardDrill: (drillId, swings, now) => get().awardPracticePoints({ key: drillId, swings, now }),
      reset: () => set({ total: 0, byDrill: {}, watchedVideos: {} }),
    }),
    {
      name: 'practice-points',
      storage: createJSONStorage(() => getPersistStorage()),
      // 2026-06-14 (audit — store hygiene) — explicit version + passthrough migrate
      // so a future shape bump upgrades cleanly instead of wiping persisted state.
      // v2 (2026-07-06) adds watchedVideos; passthrough is safe (missing key falls
      // back to the initial {} via zustand's shallow merge).
      version: 2,
      migrate: (s) => s as never,
    },
  ),
);
