/**
 * 2026-05-24 — Transient undo affordance for silent tee Marks (Flow C).
 *
 * When the declare-hole cross-check fires a silent Mark (declared
 * position diverged from GPS by more than the tee threshold), this
 * store carries the snapshot needed to revert it via the
 * UndoMarkBanner UI element. 30-second visibility window; older
 * entries are ignored by the banner.
 *
 * Snapshot includes the PREVIOUS override (which may have been null)
 * so undo can restore it precisely:
 *   - prevOverride non-null  → undo restores it via setTeeOverride
 *   - prevOverride null      → undo wipes via clearTeeOverride
 *
 * Persisted so backgrounding the app within the undo window doesn't
 * lose the affordance.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getPersistStorage } from '../services/ssrSafeStorage';
import type { TeeOverride } from '../services/courseTeeOverrides';

export interface UndoableMarkEntry {
  markedAt: number;
  courseId: string;
  hole: number;
  /** Previous override for this (course, hole), or null if there
   *  wasn't one. Undo restores or clears accordingly. */
  prevOverride: TeeOverride | null;
  /** The accuracy_m at the moment of the Mark — surfaced on the
   *  banner so the user knows WHY the cross-check thought the
   *  declared position was off. */
  accuracy_m: number | null;
  /** The yard delta the cross-check measured. */
  delta_yards: number;
}

/** Visibility window for the undo banner. After this, the banner
 *  ignores the entry — the mark is committed. */
export const UNDO_WINDOW_MS = 30_000;

interface UndoMarkState {
  current: UndoableMarkEntry | null;
  setMark: (entry: UndoableMarkEntry) => void;
  clear: () => void;
  /** Returns the current entry IFF it's still within the undo window;
   *  null otherwise. UI consumers use this to gate render. */
  getActive: () => UndoableMarkEntry | null;
}

export const useUndoMarkStore = create<UndoMarkState>()(
  persist(
    (set, get) => ({
      current: null,
      setMark: (entry) => {
        set({ current: entry });
        console.log('[undoMark] entry set hole=', entry.hole, 'delta=', entry.delta_yards, 'yards');
      },
      clear: () => set({ current: null }),
      getActive: () => {
        const c = get().current;
        if (!c) return null;
        if (Date.now() - c.markedAt > UNDO_WINDOW_MS) return null;
        return c;
      },
    }),
    {
      name: 'undo-mark-v1',
      storage: createJSONStorage(() => getPersistStorage()),
    },
  ),
);
