import { create } from 'zustand';
import type { SwingTempo } from '../hooks/useSwingDetector';

interface SwingState {
  lastTempo: SwingTempo | null;
  lastTempoMs: number | null;
  lastSwingAt: number | null;
  swingCount: number;
  /** Write a new detected swing — increments count and timestamps. */
  setLastSwing: (tempo: SwingTempo, ms: number) => void;
  reset: () => void;
}

/**
 * useSwingStore
 *
 * In-memory (non-persisted) cross-screen swing state.
 * Both the Play tab and Practice tab write here on every detected swing.
 * Any tab that subscribes will react in real time — enabling the Play screen
 * caddie to respond to swings detected on the Practice tab, and vice versa.
 */
export const useSwingStore = create<SwingState>()((set) => ({
  lastTempo:   null,
  lastTempoMs: null,
  lastSwingAt: null,
  swingCount:  0,

  setLastSwing: (tempo, ms) =>
    set((s) => ({
      lastTempo:   tempo,
      lastTempoMs: ms,
      lastSwingAt: Date.now(),
      swingCount:  s.swingCount + 1,
    })),

  reset: () =>
    set({ lastTempo: null, lastTempoMs: null, lastSwingAt: null, swingCount: 0 }),
}));
