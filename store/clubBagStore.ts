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
import { CLUB_SNAP_ORDER } from '../services/clubBagReconcile';

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
// 2026-08-24 — this was the SIXTH copy of the catalog, and the comment it replaced said "keep one
// canonical order everywhere" while declaring its own. It now reads the one owner. The ClubId
// annotation is deliberate and uncast: if services/clubRecognition's ClubId union and the catalog
// ever disagree, this line fails typecheck instead of drifting quietly.
const CLUB_ORDER: ClubId[] = [...CLUB_SNAP_ORDER];

/**
 * 2026-09-11 (Tim) — "if in competition only be allowed to add 14 and cite USGA."
 *
 * USGA/R&A Rule 4.1b(1). A player must not start a round with more than fourteen clubs; the penalty
 * is two strokes for each hole where the breach occurred, to a maximum of four. Outside competition
 * nobody counts, and plenty of golfers carry more — so this is a COMPETITION cap, never a
 * restriction on what the app lets you own or carry on a Saturday.
 */
export const USGA_CLUB_LIMIT = 14;

/** The putter's club id in the registered bag. One place, so nothing has to remember it is not 'PUTTER'. */
export const PUTTER_ID = 'PT';

/** The cap that applies to a round, or null when none does. */
export function carryLimitFor(isCompetition: boolean): number | null {
  return isCompetition ? USGA_CLUB_LIMIT : null;
}

interface ClubBagState {
  /** Registered clubs keyed by club_id — everything he OWNS. */
  clubs: Record<string, RegisteredClub>;
  /**
   * 2026-09-11 (Tim) — THE SUNDAY BAG.
   *
   * "You could think about something like my Sunday bag, since that's what they're called, and
   * you're gonna have three to six clubs in there for those kind of courses. And it would be just a
   * subspawn of the full bag."
   *
   * The missing distinction: what he OWNS and what he is CARRYING TODAY are two different facts. A
   * committed golfer owns sixteen to eighteen and carries fourteen; walking a par-3 nine he carries
   * four. The app had one list and assumed it was both, so the caddie could name a club sitting in
   * the boot of the car.
   *
   * EMPTY MEANS CARRYING EVERYTHING — the normal case and the honest default. A player who never
   * touches this is unaffected, and an empty list is never read as "carrying nothing".
   */
  carriedToday: string[];
  registerClub: (club_id: ClubId, meta?: { source?: ClubRegisterSource; note?: string; at?: number; brand?: string; model?: string; loft?: string }) => void;
  /** Update the editable product specs on an already-registered club (from the scan-review edit). */
  setClubSpecs: (club_id: ClubId, specs: { brand?: string; model?: string; loft?: string; note?: string }) => void;
  removeClub: (club_id: ClubId) => void;
  clearBag: () => void;
  /** Bag as a driver→putter-sorted array (for display + brain context). */
  bagList: () => RegisteredClub[];
  /**
   * Set the clubs in the bag TODAY. An empty array means carrying the whole registered bag.
   *
   * `limit` caps the selection — pass USGA_CLUB_LIMIT in competition. Enforced HERE rather than only
   * in the UI so a voice path or a future surface cannot start a competition round with fifteen.
   */
  setCarriedToday: (club_ids: string[], opts?: { limit?: number | null }) => void;
  /** Back to carrying everything. */
  clearCarriedToday: () => void;
  /** The clubs actually in play right now — the Sunday-bag subset, or the whole bag. */
  carriedList: () => RegisteredClub[];
  /** True when he has deliberately pared the bag down for this round. */
  isPartialBag: () => boolean;
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
      carriedToday: [],
      setCarriedToday: (club_ids, opts) => {
        // Only ids he actually owns — a carried club that is not in the bag is not a fact.
        const owned = new Set(Object.keys(get().clubs));
        let next = [...new Set(club_ids)].filter((id) => owned.has(id));
        /**
         * 2026-09-11 (Tim) — "if in competition only be allowed to add 14 and cite USGA."
         *
         * USGA/R&A Rule 4.1b(1): a player must not START a round with more than fourteen clubs. The
         * penalty is two strokes per hole where the breach happened, capped at four — so a bag the
         * app let you pack wrong is a real scorecard cost, not a cosmetic one.
         *
         * The PUTTER is kept whatever else is trimmed. Nobody plays a round without one, and losing
         * it to an arbitrary slice of the list would be the app making the worst possible choice on
         * the player's behalf.
         */
        const limit = opts?.limit ?? null;
        if (limit != null && next.length > limit) {
          /**
           * 'PT'. Not 'PUTTER' — which is what this line said until typecheck caught it against the
           * ClubId union, and which would have silently trimmed the putter out of a competition bag
           * while the comment above claimed the opposite. A constant asserted in prose and never
           * checked against the type is exactly the shape of thing that ships wrong.
           * [[state-what-you-measured-not-what-you-intended]]
           */
          const putter = next.find((id) => id === PUTTER_ID);
          const rest = next.filter((id) => id !== putter);
          next = putter ? [putter, ...rest.slice(0, Math.max(0, limit - 1))] : rest.slice(0, limit);
        }
        set({ carriedToday: next });
      },
      clearCarriedToday: () => set({ carriedToday: [] }),
      carriedList: () => {
        const all = get().bagList();
        const carried = get().carriedToday;
        if (!carried || carried.length === 0) return all;   // empty = carrying everything
        const keep = new Set(carried);
        const subset = all.filter((c) => keep.has(c.club_id));
        /**
         * A subset that resolves to nothing means the registered bag changed under it — a club was
         * removed after the Sunday bag was chosen. Fall back to the whole bag rather than telling
         * the caddie he is carrying none, which would silence every club call.
         */
        return subset.length > 0 ? subset : all;
      },
      isPartialBag: () => {
        const carried = get().carriedToday;
        return carried.length > 0 && carried.length < Object.keys(get().clubs).length;
      },
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
