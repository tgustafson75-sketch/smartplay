import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getPersistStorage } from '../services/ssrSafeStorage';

/**
 * 2026-06-15 (Tim) — "let me run live for now so I see the graph build, then we
 * can re-estimate my start clean point."
 *
 * The library points→performance graph counts only sessions on/after this
 * baseline, so it starts CLEAN and builds LIVE as new practice lands — instead of
 * pre-loading the historical estimate. The future "re-estimate my clean start"
 * step just moves this baseline earlier (or to 0 = all-time) to fold in history.
 * Set once on first view; persisted.
 */
interface PointsBaselineState {
  /** Live-start timestamp; null until first set. Sessions before it aren't counted. */
  baselineMs: number | null;
  /** Set the baseline to `now` once (first run). No-op if already set. */
  ensureBaseline: (now: number) => void;
  /** Re-estimate the clean start: move the baseline (0 = count all-time history). */
  setBaseline: (ms: number | null) => void;
}

export const usePointsBaselineStore = create<PointsBaselineState>()(
  persist(
    (set, get) => ({
      baselineMs: null,
      ensureBaseline: (now) => { if (get().baselineMs == null) set({ baselineMs: now }); },
      setBaseline: (ms) => set({ baselineMs: ms }),
    }),
    {
      name: 'points-baseline',
      storage: createJSONStorage(() => getPersistStorage()),
      version: 1,
      migrate: (s) => s as never,
    },
  ),
);
