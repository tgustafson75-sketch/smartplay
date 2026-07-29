/**
 * 2026-07-29 (Tim — "a constant-updating What's New for the version in the tools menu, not a prompted
 * announcement that messes with the voice path"). Tracks how many WHATS_NEW entries the player has
 * seen, so the Tools menu can show a "N new" badge and the What's New screen can mark them read. The
 * changelog itself lives in services/knowledgeBase/whatsNew.ts (WHATS_NEW) — this is just the read-state.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getPersistStorage } from '../services/ssrSafeStorage';
import { WHATS_NEW } from '../services/knowledgeBase/whatsNew';

interface WhatsNewState {
  /** How many entries (from the TOP of WHATS_NEW) the player has already seen. */
  seenCount: number;
  markAllSeen: () => void;
}

export const useWhatsNewStore = create<WhatsNewState>()(
  persist(
    (set) => ({
      seenCount: 0,
      markAllSeen: () => set({ seenCount: WHATS_NEW.length }),
    }),
    { name: 'whats-new-v1', storage: createJSONStorage(() => getPersistStorage()) },
  ),
);

/** Unseen count = how many new entries since the player last opened the panel (WHATS_NEW is newest-first). */
export function unseenWhatsNewCount(): number {
  try { return Math.max(0, WHATS_NEW.length - useWhatsNewStore.getState().seenCount); }
  catch { return 0; }
}
