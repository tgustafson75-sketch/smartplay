/**
 * features/smartCaddie/hooks/usePlayerModel.ts
 *
 * Derives a live player model from the current round shots and persisted
 * club-distance data.  Re-computes only when shots or distances change.
 */

import { useMemo } from 'react';
import { useRoundStore } from '../../../store/roundStore';
import { analyzeShotPatterns, analyzeClubPatterns } from '../data/shotPatterns';
import type { ShotPattern, ClubPattern, MissDirection } from '../data/shotPatterns';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type MissSide = 'left' | 'right' | 'center';
export type DistanceBias = 'short' | 'long' | 'neutral';

export interface PlayerTendencies {
  /** Struggles to commit to partial / less-than-full wedge shots */
  strugglesWithPartialWedges: boolean;
  /** Consistently leaves the ball short of the target */
  missesShort: boolean;
  /** Hesitates over shot selection — takes extra time or changes clubs */
  indecision: boolean;
  /** Dominant horizontal miss direction derived from shot history */
  miss: MissSide;
  /** Whether player habitually carries short or long of the target */
  distanceBias: DistanceBias;
}

export interface PlayerStats {
  /** Fairways hit rate (0–1) */
  fairwayAccuracy: number;
  /** Greens in regulation rate (0–1) */
  gir: number;
  /** Average putts per hole */
  putting: number;
}

export interface PlayerModel {
  /** Full shot pattern analysis */
  pattern: ShotPattern;
  /** Per-club breakdown */
  clubPatterns: ClubPattern[];
  /** Dominant miss direction (convenience alias) */
  dominantMiss: MissDirection;
  /** How many shots are in the current session */
  shotCount: number;
  /** Live round stats derived from shot history */
  stats: PlayerStats;
  /** Behavioural tendencies — inform caddie messaging */
  tendencies: PlayerTendencies;
  /**
   * Best club recommendation for a given yardage — returns null when
   * there is not enough data (< 2 shots with that club).
   */
  recommendClub: (yards: number) => string | null;
  /**
   * Average carry distance for a specific club from this session.
   * Returns null when no GPS data is available.
   */
  clubAvgDistance: (club: string) => number | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Default club carry distances (amateur fallbacks)
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_YARDS: [string, number][] = [
  ['Driver',  230], ['3 Wood', 210], ['5 Wood', 195],
  ['4 Iron',  175], ['5 Iron', 165], ['6 Iron', 155],
  ['7 Iron',  145], ['8 Iron', 135], ['9 Iron', 125],
  ['PW',      115], ['GW',     100], ['SW',      85], ['LW', 70],
];

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export function usePlayerModel(): PlayerModel {
  const shots = useRoundStore((s) => s.shots);

  const pattern = useMemo(() => analyzeShotPatterns(shots), [shots]);
  const clubPatterns = useMemo(() => analyzeClubPatterns(shots), [shots]);

  // Build a lookup of learned avg distances from this session's GPS data.
  const learnedDistances = useMemo(() => {
    const map = new Map<string, number>();
    for (const cp of clubPatterns) {
      if (cp.avgDistance !== null && cp.total >= 2) map.set(cp.club, cp.avgDistance);
    }
    return map;
  }, [clubPatterns]);

  // ── Live round stats ──────────────────────────────────────────────────────
  const stats = useMemo<PlayerStats>(() => {
    const total = shots.length;
    if (total === 0) return { fairwayAccuracy: 1.0, gir: 0.05, putting: 2.0 };

    // Fairway accuracy: center shots off the tee (Driver / 3 Wood)
    const teeShots = shots.filter((s) => s.club === 'Driver' || s.club === '3 Wood');
    const fairwayHits = teeShots.filter((s) => s.result === 'center').length;
    const fairwayAccuracy = teeShots.length > 0 ? fairwayHits / teeShots.length : 1.0;

    // GIR proxy: approach shots (90–220 yds) that land center
    const approachShots = shots.filter((s) => s.distance != null && s.distance >= 90 && s.distance <= 220);
    const gir = approachShots.length > 0
      ? approachShots.filter((s) => s.result === 'center').length / approachShots.length
      : 0.05;

    // Putting: not tracked in shot model yet — return default
    const putting = 2.0;

    return { fairwayAccuracy, gir, putting };
  }, [shots]);

  // ── Behavioural tendencies ────────────────────────────────────────────────
  const tendencies = useMemo<PlayerTendencies>(() => {
    const total = shots.length;

    // Partial wedge struggles: wedge shots (< 90 yds) that miss short or go offline
    const wedgeShots = shots.filter((s) => s.distance != null && s.distance < 90);
    const wedgeMisses = wedgeShots.filter((s) => s.result !== 'center').length;
    const strugglesWithPartialWedges =
      wedgeShots.length >= 3 && wedgeMisses / wedgeShots.length >= 0.5;

    // Misses short: shots where recorded distance < yardsBefore (came up short)
    const shortShots = shots.filter(
      (s) => s.yardsBefore != null && s.distance != null && s.distance < s.yardsBefore * 0.88,
    );
    const missesShort = total >= 5 && shortShots.length / total >= 0.4;

    // Indecision proxy: multiple shots on same hole with different clubs
    const holeClubes: Record<number, Set<string>> = {};
    for (const s of shots) {
      if (!holeClubes[s.hole]) holeClubes[s.hole] = new Set();
      holeClubes[s.hole].add(s.club);
    }
    const indecisionHoles = Object.values(holeClubes).filter((clubs) => clubs.size >= 3).length;
    const indecision = indecisionHoles >= 2;

    // Dominant horizontal miss
    const leftMisses  = shots.filter((s) => s.result === 'left').length;
    const rightMisses = shots.filter((s) => s.result === 'right').length;
    let miss: MissSide = 'center';
    if (total >= 5) {
      if (rightMisses / total >= 0.4)      miss = 'right';
      else if (leftMisses / total >= 0.4)  miss = 'left';
    }

    // Distance bias
    let distanceBias: DistanceBias = 'neutral';
    if (total >= 5) {
      distanceBias = missesShort ? 'short' : 'neutral';
    }

    return { strugglesWithPartialWedges, missesShort, indecision, miss, distanceBias };
  }, [shots]);

  const clubAvgDistance = (club: string): number | null =>
    learnedDistances.get(club) ?? null;

  const recommendClub = (yards: number): string | null => {
    const yardMap: [string, number][] = DEFAULT_YARDS.map(([name, def]) => [
      name,
      learnedDistances.get(name) ?? def,
    ]);

    let bestClub: string | null = null;
    let bestDiff = Infinity;
    for (const [name, dist] of yardMap) {
      const diff = Math.abs(dist - yards);
      if (diff < bestDiff) { bestDiff = diff; bestClub = name; }
    }
    return bestClub;
  };

  return {
    pattern,
    clubPatterns,
    dominantMiss: pattern.dominantMiss,
    shotCount: shots.length,
    stats,
    tendencies,
    recommendClub,
    clubAvgDistance,
  };
}
