/**
 * store/bagStore.ts
 *
 * Persisted store for the player's bag: selected clubs + per-club distances.
 * Written during onboarding and read by ClubEngine / usePlayerModel.
 * Auto-learning updates distances in-place via updateClubDistance().
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ClubName } from '../types/club';

// ─── Default carry distances (mid-amateur baseline) ──────────────────────────
export const DEFAULT_DISTANCES: Record<ClubName, number> = {
  Driver: 230,
  '3W':   210,
  '5W':   195,
  '3H':   188,
  '4H':   180,
  '5I':   170,
  '6I':   160,
  '7I':   150,
  '8I':   140,
  '9I':   130,
  PW:     115,
  GW:     100,
  SW:      85,
  LW:      70,
};

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface BagState {
  /** Clubs the player has confirmed are in their bag */
  selectedClubs: ClubName[];
  /** Per-club average carry distance (yds). Starts from defaults; refined by shots. */
  clubDistances: Partial<Record<ClubName, number>>;
  /** True once the user has completed bag setup at least once */
  bagSetupDone: boolean;

  setSelectedClubs: (clubs: ClubName[]) => void;
  setClubDistance: (club: ClubName, yards: number) => void;
  setClubDistances: (distances: Partial<Record<ClubName, number>>) => void;
  setBagSetupDone: (value: boolean) => void;
  /** Weighted-average update for auto-learning (80 % old, 20 % new) */
  learnClubDistance: (club: ClubName, actualYards: number) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Store
// ─────────────────────────────────────────────────────────────────────────────

export const useBagStore = create<BagState>()(
  persist(
    (set, get) => ({
      selectedClubs: [],
      clubDistances: {},
      bagSetupDone: false,

      setSelectedClubs: (clubs) => set({ selectedClubs: clubs }),

      setClubDistance: (club, yards) =>
        set((s) => ({ clubDistances: { ...s.clubDistances, [club]: yards } })),

      setClubDistances: (distances) =>
        set((s) => ({ clubDistances: { ...s.clubDistances, ...distances } })),

      setBagSetupDone: (value) => set({ bagSetupDone: value }),

      learnClubDistance: (club, actualYards) => {
        const { clubDistances } = get();
        const current = clubDistances[club] ?? DEFAULT_DISTANCES[club] ?? actualYards;
        // 80/20 weighted average — smooth, non-jumpy
        const updated = Math.round(current * 0.8 + actualYards * 0.2);
        set((s) => ({ clubDistances: { ...s.clubDistances, [club]: updated } }));
      },
    }),
    {
      name: 'smartplay-bag',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
