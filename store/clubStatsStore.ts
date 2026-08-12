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
import { STANDARD_CARRY_YARDS, ROLL_YARDS as SHARED_ROLL_YARDS } from '../services/standardBag';
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
// 2026-08-12 — the standard bag moved to services/standardBag.ts so SmartMotion's carry estimate,
// the caddie's spoken ladder and this plausibility band all quote the SAME numbers. Three private
// copies had drifted (Driver 245 / 250 / 230), which is how the caddie could say a driver goes 250
// while the swing card said the same swing carried 198.
const STANDARD_YARDS: Record<ClubName, number> = STANDARD_CARRY_YARDS;

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
const ROLL_YARDS: Record<ClubName, number> = SHARED_ROLL_YARDS;

/**
 * 2026-08-10 (Tim — "164-yard shot and the caddie defaults to gap wedge") — the PLAUSIBILITY BAND.
 *
 * ROOT CAUSE of the wedge-on-a-mid-iron bug: recordInto() sets avgYards = the FIRST sample verbatim,
 * with no sanity check. One mis-attributed shot (wrong club tagged on a tracked GPS total, a
 * cart-mark on the wrong hole, a bad Arccos row) wrote GW = 164y — and from then on inferClub()
 * legitimately picked GW for a 164y shot, because by the store's own numbers GW *was* the closest
 * club. It is self-reinforcing: every later GW shot averages against the poisoned anchor.
 *
 * The rule: a club's distance must sit within this band of its EXPECTED distance — the player's own
 * stated My-Bag number when they've given one, otherwise the standard chart. Generous enough that a
 * long hitter's Driver (245 chart → 135-355) or a strong player's 9I (122 → 67-177) still learns
 * normally; tight enough that a GW (102 total → 56-148) can never claim a 164y shot.
 *
 * Applied at BOTH ends, deliberately:
 *   - INGEST (recordCarry/recordTotal) — implausible samples never enter a ladder.
 *   - READ (inferClub) — an ALREADY-poisoned ladder heals itself without a data migration, so the
 *     fix reaches players whose store was corrupted before this shipped (i.e. Tim's, today).
 */
const PLAUSIBLE_LO = 0.55;
const PLAUSIBLE_HI = 1.45;

/** The distance we EXPECT for this club in the given ladder's unit: stated My-Bag carry when the
 *  player gave one, else the standard chart. Putter → 0 (no band; it is never inferred). */
function expectedYards(
  club: ClubName,
  ladder: 'carry' | 'total',
  manual: Partial<Record<ClubName, number>>,
): number {
  const stated = manual[club];
  const base = stated != null && stated > 0 ? stated : STANDARD_YARDS[club];
  if (base <= 0) return 0;
  return ladder === 'carry' ? base : base + ROLL_YARDS[club];
}

/** True when `yards` is physically believable for this club. A zero/absent expectation (Putter)
 *  imposes no band, so this can never reject data for a club we have no opinion about. */
function isPlausibleForClub(
  club: ClubName,
  yards: number,
  ladder: 'carry' | 'total',
  manual: Partial<Record<ClubName, number>>,
): boolean {
  const center = expectedYards(club, ladder, manual);
  if (!(center > 0)) return true;
  return yards >= center * PLAUSIBLE_LO && yards <= center * PLAUSIBLE_HI;
}

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
        // 2026-08-10 — plausibility gate (see PLAUSIBLE_LO). A wildly out-of-band sample is a
        // mis-attribution, not a career shot; dropping it protects the ladder from one bad row.
        if (!isPlausibleForClub(club, yards, 'carry', get().manual)) {
          console.log(`[clubStats] rejected implausible ${club} carry ${Math.round(yards)}y (expected ~${expectedYards(club, 'carry', get().manual)}y)`);
          return;
        }
        set((s) => ({ carry: recordInto(s.carry, club, yards) }));
      },
      recordTotal: (club, yards) => {
        if (!Number.isFinite(yards) || yards <= 0) return;
        if (!isPlausibleForClub(club, yards, 'total', get().manual)) {
          console.log(`[clubStats] rejected implausible ${club} total ${Math.round(yards)}y (expected ~${expectedYards(club, 'total', get().manual)}y)`);
          return;
        }
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
        // 2026-08-10 (Tim — "164y and the caddie defaults to gap wedge"). Two guards, both required:
        //
        // 1) HEAL a poisoned ladder at read time. A club whose learned total is outside its
        //    plausibility band is a mis-attribution that already got persisted (the ingest gate only
        //    protects data written from now on). Fall back to its expected distance for INFERENCE so
        //    a corrupted GW can't claim a mid-iron yardage — without silently deleting the player's
        //    data, which stays visible/correctable in My Bag.
        // 2) Only recommend clubs the player ACTUALLY CARRIES. The registered bag is the roster
        //    ([[clubBagStore]]); when it's empty (not registered yet) every club stays eligible, so
        //    this can never leave the caddie with nothing to suggest.
        const bagKeys = (() => {
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { useClubBagStore } = require('./clubBagStore') as typeof import('./clubBagStore');
            const ids = Object.keys(useClubBagStore.getState().clubs ?? {});
            const names = ids.map(clubIdToClubName).filter((n): n is ClubName => n != null && n !== 'Putter');
            return names.length > 0 ? new Set<ClubName>(names) : null;
          } catch {
            return null; // bag unavailable → no restriction (fail open, never blocks a recommendation)
          }
        })();

        let best: ClubName = '7I';
        let bestDiff = Infinity;
        for (const club of CLUB_ORDER) {
          if (club === 'Putter') continue;
          if (bagKeys && !bagKeys.has(club)) continue;
          const learned = g.totalFor(club); // match a to-target (total-ish) yardage against total distances
          const dist = isPlausibleForClub(club, learned, 'total', g.manual)
            ? learned
            : expectedYards(club, 'total', g.manual);
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
