/**
 * Tiny global toast store.
 *
 * Any surface can call useToastStore.getState().show("text") to flash
 * a 1.5s snackbar near the top of the screen. The <GlobalToast /> view
 * (mounted at app/_layout.tsx) reads this store and renders the toast.
 *
 * Used by the trust-level cyclers (local Tools + GlobalToolsMenu) to
 * give consistent visual feedback on mode change so the transition
 * never feels like "nothing happened."
 */

import { create } from 'zustand';

interface ToastState {
  message: string | null;
  /** Monotonic counter so consecutive identical messages still trigger
   *  a re-render + animation in the view. */
  seq: number;
  show: (message: string) => void;
  clear: () => void;
}

export const useToastStore = create<ToastState>((set) => ({
  message: null,
  seq: 0,
  show: (message) =>
    set((s) => ({ message, seq: s.seq + 1 })),
  clear: () => set({ message: null }),
}));
