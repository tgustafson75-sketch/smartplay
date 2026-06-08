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
  'Driver', '3W', '5W', '7W', '2H', '3H', '4H',
  '3I', '4I', '5I', '6I', '7I', '8I', '9I',
  'PW', 'GW', 'SW', 'LW', 'Putter',
] as const;
export type ClubName = (typeof CLUB_ORDER)[number];

/** Standard amateur carry chart (yds) — inference fallback before the
 *  player has logged enough real shots. Mid-handicap baseline. */
const STANDARD_YARDS: Record<ClubName, number> = {
  Driver: 230, '3W': 210, '5W': 195, '7W': 180,
  '2H': 200, '3H': 190, '4H': 180,
  '3I': 180, '4I': 170, '5I': 160, '6I': 150, '7I': 140, '8I': 130, '9I': 120,
  PW: 110, GW: 95, SW: 80, LW: 60, Putter: 0,
};

export interface ClubStat {
  club: ClubName;
  samples: number;
  /** Rolling average carry (yds). */
  avgYards: number;
  lastYards: number;
  lastUsedAt: number;
}

interface ClubStatsState {
  stats: Partial<Record<ClubName, ClubStat>>;
  /** Record a tracked shot: updates the club's rolling average + usage. */
  record: (club: ClubName, yards: number) => void;
  /** Learned average for a club, or the standard-chart value if none yet. */
  avgFor: (club: ClubName) => number;
  /** True if we have any real sample for this club. */
  hasSamples: (club: ClubName) => boolean;
  /** Best default club for a needed yardage: closest learned avg (or
   *  standard chart). Putter excluded from full-shot inference. */
  inferClub: (yards: number) => ClubName;
  /** Bag sorted by usage (most-used first) — for stats/usage views. */
  bagByUsage: () => ClubStat[];
  clearAll: () => void;
}

// Weighted rolling average: recent shots matter more, but a single
// mishit can't swing the average wildly. New = old*(1-w) + sample*w,
// with w shrinking as samples grow (caps the early volatility).
function rollingAvg(prevAvg: number, prevSamples: number, sample: number): number {
  const w = Math.max(0.15, 1 / (prevSamples + 1));
  return prevAvg * (1 - w) + sample * w;
}

export const useClubStatsStore = create<ClubStatsState>()(
  persist(
    (set, get) => ({
      stats: {},
      record: (club, yards) => {
        if (!Number.isFinite(yards) || yards <= 0) return;
        set((s) => {
          const prev = s.stats[club];
          const samples = (prev?.samples ?? 0) + 1;
          const avgYards = prev ? rollingAvg(prev.avgYards, prev.samples, yards) : yards;
          return {
            stats: {
              ...s.stats,
              [club]: {
                club,
                samples,
                avgYards: Math.round(avgYards),
                lastYards: Math.round(yards),
                lastUsedAt: Date.now(),
              },
            },
          };
        });
      },
      avgFor: (club) => get().stats[club]?.avgYards ?? STANDARD_YARDS[club],
      hasSamples: (club) => (get().stats[club]?.samples ?? 0) > 0,
      inferClub: (yards) => {
        const g = get();
        let best: ClubName = '7I';
        let bestDiff = Infinity;
        for (const club of CLUB_ORDER) {
          if (club === 'Putter') continue;
          const avg = g.stats[club]?.avgYards ?? STANDARD_YARDS[club];
          const diff = Math.abs(avg - yards);
          if (diff < bestDiff) { bestDiff = diff; best = club; }
        }
        return best;
      },
      bagByUsage: () => {
        const list = Object.values(get().stats).filter((x): x is ClubStat => !!x);
        return list.sort((a, b) => b.samples - a.samples);
      },
      clearAll: () => set({ stats: {} }),
    }),
    {
      name: 'club-stats-v1',
      version: 1,
      storage: createJSONStorage(() => getPersistStorage()),
    },
  ),
);

/** Snapshot of learned averages as a {club: yards} map — for feeding
 *  swingMetricsService.profile.clubDistances and caddie recommendations. */
export function getLearnedClubDistances(): Record<string, number> {
  const stats = useClubStatsStore.getState().stats;
  const out: Record<string, number> = {};
  for (const club of CLUB_ORDER) {
    const st = stats[club];
    if (st && st.samples > 0) out[club] = st.avgYards;
  }
  return out;
}
