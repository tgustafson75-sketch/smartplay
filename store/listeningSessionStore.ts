/**
 * Mirrors the current state of services/listeningSession so any UI
 * surface (BrandHeaderRow badge, status indicators, etc.) can subscribe
 * and react. The listening session itself drives this store with
 * setState() on every transition.
 */

import { create } from 'zustand';

export type ListeningState = 'idle' | 'opening' | 'listening' | 'thinking' | 'responding';

interface ListeningSessionState {
  state: ListeningState;
  setState: (next: ListeningState) => void;
}

export const useListeningSessionStore = create<ListeningSessionState>((set) => ({
  state: 'idle',
  setState: (next) => set({ state: next }),
}));
