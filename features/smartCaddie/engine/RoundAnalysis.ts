/**
 * features/smartCaddie/engine/RoundAnalysis.ts
 *
 * Pure analytics over a completed round's shot data.
 * Consumes `Shot[]` (from roundStore) + `RoundShot[]` (caddie round store)
 * and returns a structured analysis object consumed by InsightEngine.
 *
 * No React. Runs synchronously — O(n) on shot count.
 */

import { CLUBS } from '../types/club';
import type { ClubName } from '../types/club';
import type { Shot, ShotResult } from '../../../store/roundStore';
import type { RoundShot } from '../hooks/useRoundStore';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ClubUsageStat {
  total:     number;
  misses:    number;
  distances: number[];  // raw distances for avg calc
}

export interface RoundAnalysis {
  totalShots:   number;
  /** Average gap: positive = player grabbed stronger club than recommended */
  avgClubDiff:  number;
  missCounts:   Record<ShotResult, number>;
  /** Per-club: how many times used + miss rate */
  clubUsage:    Partial<Record<string, ClubUsageStat>>;
  /** 0–100 performance proxy */
  performanceScore: number;
  /** Best-performing club today (lowest miss rate, ≥2 shots) */
  bestClub:     string | null;
  /** Most-struggled club today (highest miss rate, ≥2 shots) */
  worstClub:    string | null;
  /** Dominant miss direction */
  dominantMiss: ShotResult | null;
}

// ── Club index helper (CLUBS is ordered strong → weak) ────────────────────────

function clubIndex(name: string): number {
  const idx = (CLUBS as readonly string[]).indexOf(name as ClubName);
  return idx === -1 ? -1 : idx;
}

// ── Main function ─────────────────────────────────────────────────────────────

/**
 * @param shots       Full Shot[] from roundStore (trajectory + result data)
 * @param roundShots  RoundShot[] from useRoundStore (recommended vs selected)
 */
export function analyzeRound(
  shots:       Shot[],
  roundShots:  RoundShot[],
): RoundAnalysis | null {
  if (!shots || shots.length === 0) return null;

  // ── Miss counts ────────────────────────────────────────────────────────────
  const missCounts: Record<ShotResult, number> = {
    left: 0, right: 0, center: 0, short: 0, long: 0,
  };

  for (const s of shots) {
    if (s.result in missCounts) missCounts[s.result]++;
  }

  // ── Club usage ─────────────────────────────────────────────────────────────
  const clubUsage: Partial<Record<string, ClubUsageStat>> = {};

  for (const s of shots) {
    const key = s.club || 'Unknown';
    if (!clubUsage[key]) clubUsage[key] = { total: 0, misses: 0, distances: [] };
    clubUsage[key]!.total++;
    if (s.result !== 'center') clubUsage[key]!.misses++;
    if (s.distance > 0) clubUsage[key]!.distances.push(s.distance);
  }

  // ── Recommended vs actual club diff ───────────────────────────────────────
  let clubDiffTotal = 0;
  let clubDiffCount = 0;

  for (const rs of roundShots) {
    const recIdx = clubIndex(rs.recommended);
    const selIdx = clubIndex(rs.selected);
    if (recIdx !== -1 && selIdx !== -1) {
      clubDiffTotal += recIdx - selIdx; // lower idx = stronger club
      clubDiffCount++;
    }
  }

  const avgClubDiff = clubDiffCount > 0 ? clubDiffTotal / clubDiffCount : 0;

  // ── Best / worst club ──────────────────────────────────────────────────────
  let bestClub:      string | null = null;
  let worstClub:     string | null = null;
  let bestMissRate  = Infinity;
  let worstMissRate = -Infinity;

  for (const [club, stat] of Object.entries(clubUsage)) {
    if (!stat || stat.total < 2) continue;
    const rate = stat.misses / stat.total;
    if (rate < bestMissRate)  { bestMissRate  = rate; bestClub  = club; }
    if (rate > worstMissRate) { worstMissRate = rate; worstClub = club; }
  }

  // ── Dominant miss ──────────────────────────────────────────────────────────
  const missEntries = Object.entries(missCounts) as [ShotResult, number][];
  const sorted      = [...missEntries].sort((a, b) => b[1] - a[1]);
  const dominantMiss = sorted[0][1] > 0 ? sorted[0][0] : null;

  // ── Performance score (0–100) ──────────────────────────────────────────────
  // Good shots / total, penalised by club-diff magnitude
  const goodShots       = missCounts.center;
  const accuracyScore   = shots.length > 0 ? (goodShots / shots.length) * 100 : 0;
  const clubDiffPenalty = Math.min(Math.abs(avgClubDiff) * 10, 30);
  const performanceScore = Math.round(Math.max(0, accuracyScore - clubDiffPenalty));

  return {
    totalShots: shots.length,
    avgClubDiff,
    missCounts,
    clubUsage,
    performanceScore,
    bestClub,
    worstClub,
    dominantMiss,
  };
}
