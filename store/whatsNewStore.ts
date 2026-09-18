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
  /**
   * 2026-09-17 — has the install-time baseline actually been WRITTEN to storage?
   *
   * This exists because the default below could not persist itself. See the note on
   * FRESH_INSTALL_SEEN_COUNT: without a flag that starts false and is flipped true, there is no
   * state change on a fresh launch, zustand/persist never calls setItem, and the "seen everything"
   * baseline is silently recomputed from whichever bundle happens to be running.
   */
  baselineStamped: boolean;
  markAllSeen: () => void;
  /** Write the install-time baseline once. Idempotent; called on rehydrate. */
  stampBaseline: () => void;
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
/**
 * 2026-09-17 — AND A DEFAULT THAT CANNOT PERSIST ITSELF IS NOT A BASELINE, IT IS A RECOMPUTE.
 *
 * The 09-03 fix above is right and was silently doing nothing on any install after it. zustand's
 * persist middleware writes on a state CHANGE; a fresh launch that only reads the initial state
 * never triggers one, so nothing is ever written to storage. `FRESH_INSTALL_SEEN_COUNT` was
 * therefore re-evaluated against whatever bundle was running, every launch, forever — and since it
 * is by definition equal to WHATS_NEW.length, the unseen count was permanently ZERO.
 *
 * So What's New was dead for every fresh install: no badge on the Tools row, no hero card on the
 * Play tab, not on the second launch, not after any OTA, not ever. Only a player carrying a
 * seenCount stored before 09-03 ever saw one — which is exactly the population that was tested, and
 * is why it looked fine. Verified against the real store, not reasoned about: launch with 96 entries
 * then again with 98 and the unseen count was 0 both times, with storage still `{}`.
 *
 * `baselineStamped` is the fix and the whole trick: it starts false, so the first rehydrate has
 * something real to CHANGE, which is what makes persist write. After that the stored seenCount is a
 * genuine record of "what existed the day you installed", and an OTA that adds entries shows them.
 * [[silence-is-not-an-answer]]
 */
const FRESH_INSTALL_SEEN_COUNT = WHATS_NEW.length;

export const useWhatsNewStore = create<WhatsNewState>()(
  persist(
    (set, get) => ({
      seenCount: FRESH_INSTALL_SEEN_COUNT,
      baselineStamped: false,
      markAllSeen: () => set({ seenCount: WHATS_NEW.length, baselineStamped: true }),
      stampBaseline: () => {
        if (get().baselineStamped) return;
        // Deliberately the CURRENT length rather than FRESH_INSTALL_SEEN_COUNT: identical today, but
        // this runs after rehydration and must record what this bundle actually shipped with.
        set({ seenCount: WHATS_NEW.length, baselineStamped: true });
      },
    }),
    {
      name: 'whats-new-v1',
      storage: createJSONStorage(() => getPersistStorage()),
      /**
       * Runs after storage is read, for both the restored and the never-stored case. An existing
       * tester's stored seenCount rehydrates with baselineStamped still false (it was not in the v1
       * shape), so stampBaseline would overwrite their real progress — hence the guard: only stamp
       * when there was nothing stored at all.
       */
      onRehydrateStorage: () => (state, error) => {
        if (error || !state) return;
        if (state.baselineStamped) return;
        // A restored pre-flag record is identifiable: it carries a seenCount that is not the
        // current length. Leave those alone and simply mark them stamped so this never re-runs.
        if (state.seenCount !== WHATS_NEW.length) {
          useWhatsNewStore.setState({ baselineStamped: true });
          return;
        }
        useWhatsNewStore.getState().stampBaseline();
      },
    },
  ),
);

/** Unseen count = how many new entries since the player last opened the panel (WHATS_NEW is newest-first). */
export function unseenWhatsNewCount(): number {
  try { return Math.max(0, WHATS_NEW.length - useWhatsNewStore.getState().seenCount); }
  catch { return 0; }
}
