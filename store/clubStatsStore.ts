/**
 * 2026-06-07 — Club stats store (real bag yardage + usage).
 *
 * Every tracked on-course shot with a known club + measured distance is
 * recorded here, building the player's REAL per-club carry and usage
 * frequency over time (see memory club-tied-shot-tracking). This learned
 * model drives:
 *   - default-club inference for shot tracking (yardage → closest club),
 *   - caddie club recommendations,
 *   - Smart Motion carry estimates (swingMetricsService.profile.clubDistances).
 *
 * Local-only (Zustand + AsyncStorage) — no external API, per the
 * persistence decision in [[smartmotion-rebuild]].
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getPersistStorage } from '../services/ssrSafeStorage';

/** Canonical club ids, longest → shortest (used for the scroll picker order). */
export const CLUB_ORDER = [
  // 2026-07-24 (full-app audit) — added '5H' + 'AW' as their OWN slots. They were being collapsed onto
  // '4H'/'GW' by CLUB_ID_TO_NAME (no slot existed), so a 5-hybrid shared the 4-hybrid's learned distance
  // and approach-wedge shots corrupted the gap-wedge average. Additive: existing persisted data is
  // unaffected; the new slots simply start empty.
  'Driver', '3W', '5W', '7W', '2H', '3H', '4H', '5H',
  '3I', '4I', '5I', '6I', '7I', '8I', '9I',
  'PW', 'AW', 'GW', 'SW', 'LW', 'Putter',
] as const;
export type ClubName = (typeof CLUB_ORDER)[number];

// 2026-06-30 (audit C1/C10 — Tim: "wire learned carry to on-course distances") —
// map the recognizer's ClubId ('DR','7I',…) to this store's ClubName so SmartMotion can
// look up the player's REAL tracked/stated per-club carry (distanceFor / hasDistance).
// Putter + unknown → null (no full-shot carry). Type-only ClubId import = no cycle.
const CLUB_ID_TO_NAME: Record<string, ClubName> = {
  DR: 'Driver', '3W': '3W', '5W': '5W', '7W': '7W',
  '2H': '2H', '3H': '3H', '4H': '4H', '5H': '5H',
  '3I': '3I', '4I': '4I', '5I': '5I', '6I': '6I', '7I': '7I', '8I': '8I', '9I': '9I',
  PW: 'PW', GW: 'GW', AW: 'AW', SW: 'SW', LW: 'LW',
};
export function clubIdToClubName(id: string | null | undefined): ClubName | null {
  if (!id) return null;
  return CLUB_ID_TO_NAME[id] ?? null;
}

/** Standard amateur carry chart (yds) — inference fallback before the
 *  player has logged enough real shots. Mid-handicap baseline. */
// 2026-07-24 (final QA) — recalibrated to be INTERNALLY CONSISTENT for a mid-handicapper.
// The irons (7I 148, ~14y gaps) are the honest anchor; the old top-of-bag was set at scratch/tour
// levels (Driver 275 CARRY, 3W 255) and inconsistent with them, and the compressed hybrid ladder put
// 5H (206) one yard from 3I (205) → inferClub coin-flipped between a 5-hybrid and a 3-iron. Driver/
// woods/hybrids lowered to sit in sensible gaps above the irons; irons + wedges unchanged. Real logged
// shots + My Bag entries still override this fallback the moment they exist.
const STANDARD_YARDS: Record<ClubName, number> = {
  Driver: 245, '3W': 233, '5W': 223, '7W': 213,
  '2H': 215, '3H': 210, '4H': 197, '5H': 183,
  '3I': 205, '4I': 190, '5I': 175, '6I': 162, '7I': 148, '8I': 135, '9I': 122,
  PW: 110, AW: 104, GW: 98, SW: 86, LW: 74, Putter: 0,
};

export interface ClubStat {
  club: ClubName;
  samples: number;
  /** Rolling average yards (CARRY in the `carry` ladder, TOTAL tee→rest in the `total` ladder). */
  avgYards: number;
  lastYards: number;
  lastUsedAt: number;
}

/**
 * 2026-07-24 (club-logic unification) — typical ROLLOUT per club (yds), the bridge between CARRY and
 * TOTAL. Driver runs out a lot; wedges barely. Used to ESTIMATE carry from a tracked GPS total (and
 * vice-versa) so the caddie never quotes a tee→rest total as the carry the player must FLY a hazard.
 * Deliberately conservative. (Reconcile with smartfinder.estimateCarryTotal's rollout if they drift.)
 */
const ROLL_YARDS: Record<ClubName, number> = {
  Driver: 28, '3W': 22, '5W': 19, '7W': 17, '2H': 16, '3H': 15, '4H': 13, '5H': 12,
  '3I': 12, '4I': 10, '5I': 9, '6I': 8, '7I': 6, '8I': 5, '9I': 5,
  PW: 4, AW: 4, GW: 4, SW: 3, LW: 2, Putter: 0,
};

interface ClubStatsState {
  // 2026-07-24 (club-logic unification) — TWO explicit ladders so the app stops confusing units.
  //   carry = measured AIRTIME carry (acoustic/pose, range Flat-Carry, or My Bag stated).
  //   total = GPS tee→rest TOTAL (includes roll) — what cart-mark shot-tracking measures.
  // The legacy single `stats` ladder was fed a GPS TOTAL by shot-tracking but read as CARRY everywhere;
  // that's the root over-club bug. Migration v1→v2 moves old `stats` → `total` (its true unit).
  carry: Partial<Record<ClubName, ClubStat>>;
  total: Partial<Record<ClubName, ClubStat>>;
  /** 2026-06-15 (Tim — editable My Bag) — user-entered CARRY per club (their own numbers, day one). */
  manual: Partial<Record<ClubName, number>>;
  /** Per-club practice REP tally — HONEST volume, NOT a distance. */
  reps: Partial<Record<ClubName, number>>;
  /** Record a measured AIRTIME carry (acoustic/pose, range Flat-Carry, stated). */
  recordCarry: (club: ClubName, yards: number) => void;
  /** Record a GPS tee→rest TOTAL (cart-mark shot tracking — includes roll). */
  recordTotal: (club: ClubName, yards: number) => void;
  /** @deprecated back-compat alias → recordTotal (the old `record` was fed GPS totals). */
  record: (club: ClubName, yards: number) => void;
  addReps: (club: ClubName, n: number) => void;
  repsFor: (club: ClubName) => number;
  /** Set the player's stated CARRY for a club (My Bag). yards<=0 clears it. */
  setManual: (club: ClubName, yards: number) => void;
  clearManual: (club: ClubName) => void;
  /** HONEST carry: measured carry → stated → (tracked total − typical roll) → chart. The DEFAULT for
   *  club/reach/forced-carry advice (never over-states what the player can fly). */
  carryFor: (club: ClubName) => number;
  /** Tee→rest TOTAL: measured total → (carry/stated + typical roll) → chart+roll. For "how far it goes". */
  totalFor: (club: ClubName) => number;
  /** @deprecated back-compat — returns the TOTAL (what the old tracked `avgYards` effectively was). */
  avgFor: (club: ClubName) => number;
  /** @deprecated back-compat — returns totalFor (matches the old tracked-distance behavior). */
  distanceFor: (club: ClubName) => number;
  /** True if we have any real sample (carry OR total) for this club. */
  hasSamples: (club: ClubName) => boolean;
  hasManual: (club: ClubName) => boolean;
  /** True if we have ANY real number (carry, total, or stated) — not just the chart. */
  hasDistance: (club: ClubName) => boolean;
  hasCarry: (club: ClubName) => boolean;
  hasTotal: (club: ClubName) => boolean;
  /** Best default club for a needed (to-target, total-ish) yardage. */
  inferClub: (yards: number) => ClubName;
  /** Bag sorted by usage (most-used first) — carry+total samples combined. */
  bagByUsage: () => ClubStat[];
  clearAll: () => void;
}

// Weighted rolling average: recent shots matter more, but a single mishit can't swing it wildly.
function rollingAvg(prevAvg: number, prevSamples: number, sample: number): number {
  const w = Math.max(0.15, 1 / (prevSamples + 1));
  return prevAvg * (1 - w) + sample * w;
}
function recordInto(ladder: Partial<Record<ClubName, ClubStat>>, club: ClubName, yards: number): Partial<Record<ClubName, ClubStat>> {
  const prev = ladder[club];
  const samples = (prev?.samples ?? 0) + 1;
  const avgYards = prev ? rollingAvg(prev.avgYards, prev.samples, yards) : yards;
  return { ...ladder, [club]: { club, samples, avgYards: Math.round(avgYards), lastYards: Math.round(yards), lastUsedAt: Date.now() } };
}

export const useClubStatsStore = create<ClubStatsState>()(
  persist(
    (set, get) => ({
      carry: {},
      total: {},
      manual: {},
      reps: {},
      addReps: (club, n) => {
        if (!Number.isFinite(n) || n <= 0) return;
        set((s) => ({ reps: { ...s.reps, [club]: (s.reps[club] ?? 0) + Math.round(n) } }));
      },
      repsFor: (club) => get().reps[club] ?? 0,
      setManual: (club, yards) => {
        set((s) => {
          const next = { ...s.manual };
          if (!Number.isFinite(yards) || yards <= 0) delete next[club];
          else next[club] = Math.round(yards);
          return { manual: next };
        });
      },
      clearManual: (club) => {
        set((s) => {
          if (s.manual[club] == null) return {} as Partial<ClubStatsState>;
          const next = { ...s.manual };
          delete next[club];
          return { manual: next };
        });
      },
      recordCarry: (club, yards) => {
        if (!Number.isFinite(yards) || yards <= 0) return;
        set((s) => ({ carry: recordInto(s.carry, club, yards) }));
      },
      recordTotal: (club, yards) => {
        if (!Number.isFinite(yards) || yards <= 0) return;
        set((s) => ({ total: recordInto(s.total, club, yards) }));
      },
      record: (club, yards) => get().recordTotal(club, yards), // deprecated alias
      carryFor: (club) => {
        const g = get();
        const c = g.carry[club];
        if (c && c.samples > 0) return c.avgYards;              // measured carry
        if (g.manual[club] != null) return g.manual[club]!;     // stated carry (My Bag)
        const t = g.total[club];
        if (t && t.samples > 0) return Math.max(1, Math.round(t.avgYards - ROLL_YARDS[club])); // total − roll (est)
        return STANDARD_YARDS[club];                            // chart (a carry chart)
      },
      totalFor: (club) => {
        const g = get();
        const t = g.total[club];
        if (t && t.samples > 0) return t.avgYards;              // measured total
        const c = g.carry[club];
        if (c && c.samples > 0) return Math.round(c.avgYards + ROLL_YARDS[club]); // carry + roll (est)
        if (g.manual[club] != null) return Math.round(g.manual[club]! + ROLL_YARDS[club]);
        return STANDARD_YARDS[club] + ROLL_YARDS[club];         // chart carry + roll
      },
      avgFor: (club) => get().totalFor(club),      // deprecated back-compat
      distanceFor: (club) => get().totalFor(club), // deprecated back-compat
      hasSamples: (club) => (get().carry[club]?.samples ?? 0) > 0 || (get().total[club]?.samples ?? 0) > 0,
      hasCarry: (club) => (get().carry[club]?.samples ?? 0) > 0 || get().manual[club] != null,
      hasTotal: (club) => (get().total[club]?.samples ?? 0) > 0,
      hasManual: (club) => get().manual[club] != null,
      hasDistance: (club) => (get().carry[club]?.samples ?? 0) > 0 || (get().total[club]?.samples ?? 0) > 0 || get().manual[club] != null,
      inferClub: (yards) => {
        const g = get();
        let best: ClubName = '7I';
        let bestDiff = Infinity;
        for (const club of CLUB_ORDER) {
          if (club === 'Putter') continue;
          const dist = g.totalFor(club); // match a to-target (total-ish) yardage against total distances
          const diff = Math.abs(dist - yards);
          if (diff < bestDiff) { bestDiff = diff; best = club; }
        }
        return best;
      },
      bagByUsage: () => {
        const g = get();
        const merged = new Map<ClubName, ClubStat>();
        for (const ladder of [g.total, g.carry]) {
          for (const st of Object.values(ladder)) {
            if (!st) continue;
            const prev = merged.get(st.club);
            merged.set(st.club, prev ? { ...st, samples: prev.samples + st.samples } : st);
          }
        }
        return Array.from(merged.values()).sort((a, b) => b.samples - a.samples);
      },
      clearAll: () => set({ carry: {}, total: {} }),
    }),
    {
      name: 'club-stats-v1',
      version: 2,
      // 2026-07-24 — v1→v2: the old single `stats` ladder was fed a GPS tee→rest TOTAL by shot tracking,
      // so it belongs in the `total` ladder (not carry). Carry starts empty and fills from real airtime
      // carries + My Bag going forward. Manual (stated carry) + reps carry over untouched.
      migrate: (persisted: unknown, version: number) => {
        const s = (persisted ?? {}) as { stats?: Partial<Record<ClubName, ClubStat>>; total?: Partial<Record<ClubName, ClubStat>>; carry?: Partial<Record<ClubName, ClubStat>>; manual?: unknown; reps?: unknown };
        if (version < 2 && s.stats && !s.total) {
          return { ...s, total: s.stats, carry: {}, stats: undefined } as never;
        }
        return s as never;
      },
      storage: createJSONStorage(() => getPersistStorage()),
    },
  ),
);

/** Snapshot of learned TOTAL distances as a {club: yards} map (tee→rest, includes roll).
 *  Historical name/shape — consumers that quote this as "the bag" must label it a total (see
 *  caddieMemoryRetrieval). For the honest CARRY bag use getLearnedCarryDistances(). */
export function getLearnedClubDistances(): Record<string, number> {
  const s = useClubStatsStore.getState();
  const out: Record<string, number> = {};
  for (const club of CLUB_ORDER) {
    const t = s.total[club];
    if (t && t.samples > 0) out[club] = t.avgYards;
    else if (s.carry[club]?.samples) out[club] = Math.round(s.carry[club]!.avgYards + ROLL_YARDS[club]);
    else if (s.manual[club] != null) out[club] = Math.round(s.manual[club]! + ROLL_YARDS[club]);
  }
  return out;
}

/** 2026-07-24 — the honest CARRY bag: {club: carry yards} for clubs the player has real data on
 *  (measured carry, stated, or estimated from a tracked total). Feeds forced-carry / reach advice. */
export function getLearnedCarryDistances(): Record<string, number> {
  const s = useClubStatsStore.getState();
  const out: Record<string, number> = {};
  for (const club of CLUB_ORDER) {
    if (club === 'Putter') continue;
    if (s.carry[club]?.samples || s.manual[club] != null || s.total[club]?.samples) out[club] = s.carryFor(club);
  }
  return out;
}
