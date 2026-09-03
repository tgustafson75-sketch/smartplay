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

/**
 * 2026-09-03 (Tim — "since it's a new release, it's not what's new, it's what is part of the
 * tutorial and highlights").
 *
 * A FRESH INSTALL HAS SEEN EVERYTHING. This defaulted to 0, which on launch day means every
 * first-time player opens the Play tab to a hero card announcing 96 new things — about a product
 * they have never used. Most of those entries describe a CHANGE ("the club arc is drawn through the
 * ball instead of behind you"), and a change is meaningless to someone who never saw the old
 * behaviour. It reads as a patch-notes dump where a welcome should be.
 *
 * So the changelog starts the day you install. Only entries added AFTER that are new to you, which
 * is what "new" has always meant. Existing testers are untouched: zustand/persist restores their
 * stored seenCount and never applies this default, so someone sitting on 30 still sees the 66 that
 * landed since. What the app IS, rather than what changed, belongs in Tutorials.
 */
const FRESH_INSTALL_SEEN_COUNT = WHATS_NEW.length;

export const useWhatsNewStore = create<WhatsNewState>()(
  persist(
    (set) => ({
      seenCount: FRESH_INSTALL_SEEN_COUNT,
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
