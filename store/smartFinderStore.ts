import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getPersistStorage } from '../services/ssrSafeStorage';
import type { RangefinderLock } from '../types/smartfinder';

// 'measure' (2026-07-22, Tim) — GPS-free known-height rangefinder: point at any target of
// known height (flag, person, marker), tap its top + base, get the distance. Works anywhere —
// yard, cage, range, on-course — not gated to being in a round.
export type SmartFinderMode = 'standard' | 'target' | 'map' | 'putt' | 'measure';

interface SmartFinderState {
  // Transient — not persisted. AR lock from the legacy camera mode.
  currentLock: RangefinderLock | null;
  setLock: (lock: RangefinderLock | null) => void;
  clearLock: () => void;
  // Phase D-2 — persisted mode preference for the full-screen view.
  mode: SmartFinderMode;
  setMode: (mode: SmartFinderMode) => void;
}

export const useSmartFinderStore = create<SmartFinderState>()(
  persist(
    (set) => ({
      currentLock: null,
      setLock: (lock) => set({ currentLock: lock }),
      clearLock: () => set({ currentLock: null }),
      mode: 'target',
      setMode: (mode) => set({ mode }),
    }),
    {
      name: 'smartfinder-store-v1',
      // 2026-05-26 Fix BZ — __BZ_baseline__ version + passthrough migrate so future
      // version bumps don't wipe state. Replace `as never` with the real
      // state type when adding actual migration logic.
      // 2026-06-23 SF-3 — v2: retire the dead, ungated 'standard' camera path
      // (no longer UI-selectable) by mapping any persisted mode to 'target'.
      // All other persisted fields are preserved.
      version: 2,
      migrate: (s) => {
        const prev = (s ?? {}) as Partial<SmartFinderState>;
        if (prev.mode === 'standard') {
          return { ...prev, mode: 'target' } as never;
        }
        return prev as never;
      },
      storage: createJSONStorage(() => getPersistStorage()),
      partialize: (s) => ({ mode: s.mode }),
    },
  ),
);
