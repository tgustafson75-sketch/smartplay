/**
 * 2026-09-12 (Tim) — WHICH OF THE THREE DRIVERS IS IN THE BAG TODAY.
 *
 * "Same ball logic to clubs and such. Example, I have 3 drivers, all different shafts — so if I say
 *  I am going to use the TaylorMade X shaft vs Burner 2 stock shaft, that provides some degree of
 *  feedback data."
 *
 * The bag models a club SLOT ("Driver") and one set of distances for it. A player testing shafts has
 * several physical clubs in one slot, and their numbers are genuinely different — which is the whole
 * reason he is testing them. Without this, three drivers average into one blurred driver and the
 * test can never conclude.
 *
 * WHY THIS IS NOT THE BALL, EVEN THOUGH HE ASKED FOR "the same logic". A ball affects every shot of
 * the round, so comparing rounds by ball is sound. A driver shaft affects DRIVES; comparing rounds
 * by shaft would bury the signal under the putting. So the declaration works the same way — say it
 * in passing, it sticks until changed — but the comparison is per-CLUB and shot-level, in
 * services/clubVariantPerformance.
 *
 * KEYED BY NORMALISED CLUB, one variant per slot at a time: you cannot play two drivers in one
 * round. Declaring a new one replaces the old, which is what "I'm switching to the Burner today"
 * means. History is not kept here — it lives stamped on the shots, where it can be counted.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { normalizeClub } from '../services/clubNormalize';

interface ClubVariantState {
  /** normalised club name → the variant label in play, in the player's own words. */
  variants: Record<string, string>;
  /** Declare the variant in play for a club. Empty/blank label clears it. */
  setVariant: (club: string, label: string | null) => void;
  /** The variant in play for a club, or null. Accepts any spelling of the club. */
  variantFor: (club: string | null | undefined) => string | null;
  clearAll: () => void;
}

export const useClubVariantStore = create<ClubVariantState>()(
  persist(
    (set, get) => ({
      variants: {},
      setVariant: (club, label) =>
        set((s) => {
          const key = normalizeClub(club);
          if (!key) return s;
          const next = { ...s.variants };
          const clean = (label ?? '').trim();
          if (!clean) delete next[key];
          else next[key] = clean;
          return { variants: next };
        }),
      variantFor: (club) => {
        const key = normalizeClub(club ?? '');
        if (!key) return null;
        return get().variants[key] ?? null;
      },
      clearAll: () => set({ variants: {} }),
    }),
    {
      name: 'club-variant-v1',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
