import { create } from 'zustand';
import type { RangefinderLock } from '../types/smartfinder';

// Transient — not persisted. Lock lives only for the current session.

interface SmartFinderState {
  currentLock: RangefinderLock | null;
  setLock: (lock: RangefinderLock | null) => void;
  clearLock: () => void;
}

export const useSmartFinderStore = create<SmartFinderState>((set) => ({
  currentLock: null,
  setLock: (lock) => set({ currentLock: lock }),
  clearLock: () => set({ currentLock: null }),
}));
