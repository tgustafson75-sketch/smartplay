/**
 * 2026-06-09 — Last-used club for swing-capture surfaces.
 *
 * Smart Motion (and other capture flows) need to know which club the
 * user is hitting so ball speed / smash / carry are scaled honestly and
 * the CLUB chip is populated — instead of silently assuming a 7-iron.
 *
 * This store remembers the last club the user tagged so the chip defaults
 * to it next session (tap to correct). `null` means untagged → metrics
 * that depend on the club show '—'.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getPersistStorage } from '../services/ssrSafeStorage';
import type { ClubId } from '../services/clubRecognition';

interface ClubSelectionState {
  /** Last club the user tagged on a capture surface. null = untagged. */
  lastClub: ClubId | null;
  setLastClub: (club: ClubId | null) => void;
}

export const useClubSelectionStore = create<ClubSelectionState>()(
  persist(
    (set) => ({
      lastClub: null,
      setLastClub: (club) => set({ lastClub: club }),
    }),
    {
      name: 'club-selection-v1',
      storage: createJSONStorage(() => getPersistStorage()),
    },
  ),
);
