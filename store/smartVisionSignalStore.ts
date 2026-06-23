import { create } from 'zustand';

interface SmartVisionSignalState {
  pendingMark: { kind: 'tee' | 'pin'; ts: number } | null;
  signalMark: (kind: 'tee' | 'pin') => void;
  clearMark: () => void;
}

export const useSmartVisionSignalStore = create<SmartVisionSignalState>((set) => ({
  pendingMark: null,
  signalMark: (kind) => set({ pendingMark: { kind, ts: Date.now() } }),
  clearMark: () => set({ pendingMark: null }),
}));
