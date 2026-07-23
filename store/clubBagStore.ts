/**
 * 2026-07-01 (Tim — "the most natural is a voice path where you say 'look at my club / register
 * my club / add this club', the user shows the sole of the club with the number on it, and it
 * gets registered").
 *
 * The player's REGISTERED BAG — the clubs they've explicitly told the caddie they carry, distinct
 * from clubs merely inferred from swings/logs. Registration flows in from the camera club scan
 * (recognizeClubFromBase64), a voice declaration, or a manual add. The unified brain reads this so
 * it only recommends clubs the player actually has, and club-tied yardage learning gets a canonical
 * roster instead of guessing from observed shots.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getPersistStorage } from '../services/ssrSafeStorage';
import type { ClubId } from '../services/clubRecognition';

export type ClubRegisterSource = 'camera' | 'voice' | 'manual';

export interface RegisteredClub {
  club_id: ClubId;
  registered_at: number;
  source: ClubRegisterSource;
  /** Optional loft/label captured with the club, e.g. "52°". */
  note?: string;
  // 2026-07-23 (Tim — Bag Vision) — product-specific specs read from a bag scan (or typed in).
  // All optional; a club registered by voice/manual simply has none. Editable by the user.
  brand?: string;
  model?: string;
  loft?: string;
}

// Canonical bag order (driver → putter) for display + brain context.
const CLUB_ORDER: ClubId[] = [
  'DR', '3W', '5W', '7W', '2H', '3H', '4H', '5H',
  '3I', '4I', '5I', '6I', '7I', '8I', '9I',
  'PW', 'AW', 'GW', 'SW', 'LW', 'PT',
];

interface ClubBagState {
  /** Registered clubs keyed by club_id. */
  clubs: Record<string, RegisteredClub>;
  registerClub: (club_id: ClubId, meta?: { source?: ClubRegisterSource; note?: string; at?: number; brand?: string; model?: string; loft?: string }) => void;
  /** Update the editable product specs on an already-registered club (from the scan-review edit). */
  setClubSpecs: (club_id: ClubId, specs: { brand?: string; model?: string; loft?: string; note?: string }) => void;
  removeClub: (club_id: ClubId) => void;
  clearBag: () => void;
  /** Bag as a driver→putter-sorted array (for display + brain context). */
  bagList: () => RegisteredClub[];
}

export const useClubBagStore = create<ClubBagState>()(
  persist(
    (set, get) => ({
      clubs: {},
      registerClub: (club_id, meta) => {
        if (!club_id || club_id === 'unknown') return;
        set((s) => ({
          clubs: {
            ...s.clubs,
            [club_id]: {
              club_id,
              registered_at: meta?.at ?? Date.now(),
              source: meta?.source ?? 'camera',
              // Preserve existing values if the new registration doesn't carry them.
              note: meta?.note ?? s.clubs[club_id]?.note,
              brand: meta?.brand ?? s.clubs[club_id]?.brand,
              model: meta?.model ?? s.clubs[club_id]?.model,
              loft: meta?.loft ?? s.clubs[club_id]?.loft,
            },
          },
        }));
      },
      setClubSpecs: (club_id, specs) =>
        set((s) => {
          const existing = s.clubs[club_id];
          if (!existing) return s;
          return {
            clubs: {
              ...s.clubs,
              [club_id]: {
                ...existing,
                brand: specs.brand ?? existing.brand,
                model: specs.model ?? existing.model,
                loft: specs.loft ?? existing.loft,
                note: specs.note ?? existing.note,
              },
            },
          };
        }),
      removeClub: (club_id) =>
        set((s) => {
          const next = { ...s.clubs };
          delete next[club_id];
          return { clubs: next };
        }),
      clearBag: () => set({ clubs: {} }),
      bagList: () =>
        Object.values(get().clubs).sort(
          (a, b) => CLUB_ORDER.indexOf(a.club_id) - CLUB_ORDER.indexOf(b.club_id),
        ),
    }),
    {
      name: 'club-bag-v1',
      storage: createJSONStorage(() => getPersistStorage()),
      version: 1,
      migrate: (s) => s as never,
    },
  ),
);
