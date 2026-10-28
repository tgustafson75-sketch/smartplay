import { create } from 'zustand';
import type { SmartVisionState } from '../contexts/SmartVisionContext';

interface SmartVisionSignalState {
  pendingMark: { kind: 'tee' | 'pin'; ts: number } | null;
  signalMark: (kind: 'tee' | 'pin') => void;
  clearMark: () => void;
  /**
   * 2026-10-27 (Brain review F5) — what SmartVision is showing right now, mirrored by its provider so
   * the payload builder (which cannot read a React context) sends it on every route. Null when closed.
   */
  liveView: SmartVisionState | null;
  setLiveView: (view: SmartVisionState | null) => void;
}

export const useSmartVisionSignalStore = create<SmartVisionSignalState>((set) => ({
  pendingMark: null,
  signalMark: (kind) => set({ pendingMark: { kind, ts: Date.now() } }),
  clearMark: () => set({ pendingMark: null }),
  liveView: null,
  setLiveView: (view) => set({ liveView: view }),
}));
