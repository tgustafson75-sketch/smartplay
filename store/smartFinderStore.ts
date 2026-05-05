import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getPersistStorage } from '../services/ssrSafeStorage';
import type { RangefinderLock } from '../types/smartfinder';

export type SmartFinderMode = 'standard' | 'target' | 'map' | 'putt';

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
      mode: 'standard',
      setMode: (mode) => set({ mode }),
    }),
    {
      name: 'smartfinder-store-v1',
      storage: createJSONStorage(() => getPersistStorage()),
      partialize: (s) => ({ mode: s.mode }),
    },
  ),
);
