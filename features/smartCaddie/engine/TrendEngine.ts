/**
 * TrendEngine.ts
 *
 * Pure, synchronous analysis of cross-round performance data.
 * Operates on RoundSummary[] stored in aiProfileStore.roundHistory.
 * Requires at least 3 rounds before returning meaningful trends.
 */

import type { RoundSummary } from '../../../services/localLearning';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type MissDirection = 'left' | 'right' | 'short' | 'center' | 'mixed';

export interface ClubBias {
  /** Positive = consistently clubs up vs recommendation; negative = clubs down */
  avgClubDiff: number;
  /** 'up' | 'down' | 'neutral' */
  direction: 'up' | 'down' | 'neutral';
}

export interface ImprovementTrend {
  /** 'improving' | 'declining' | 'steady' */
  direction: 'improving' | 'declining' | 'steady';
  /** Delta between average performance score of first half vs second half (recent - old) */
  scoreDelta: number;
  /** Whether we have enough score data to draw a conclusion */
  hasData: boolean;
}

export interface RoundTrends {
  /** Number of rounds analysed */
  roundCount: number;
  /** Predominant miss direction across all rounds */
  dominantMiss: MissDirection;
  /** Club selection bias */
  clubBias: ClubBias;
  /** Trend in performance score over rounds */
  improvement: ImprovementTrend;
  /** Average shots per round */
  avgShots: number;
  /** Most-used club across all rounds */
  topClub: string | null;
  /** Consistency score 0–100: how stable miss pattern is (100 = always same side) */
  consistencyScore: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const MIN_ROUNDS = 3;
const NEUTRAL_THRESHOLD = 0.4; // avgClubDiff within ±0.4 is neutral

// ─────────────────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Analyse an array of RoundSummary objects and return cross-round trends.
 * Returns null when there are fewer than MIN_ROUNDS (3) rounds.
 */
export function analyzeTrends(rounds: RoundSummary[]): RoundTrends | null {
  if (!rounds || rounds.length < MIN_ROUNDS) return null;

  const n = rounds.length;

  // ── Miss pattern ────────────────────────────────────────────────────────
  let totalLeft = 0;
  let totalRight = 0;
  let totalCenter = 0;

  rounds.forEach((r) => {
    totalLeft   += r.leftCount  ?? 0;
    totalRight  += r.rightCount ?? 0;
    totalCenter += r.centerCount ?? 0;
  });

  const totalMiss = totalLeft + totalRight + totalCenter;
  let dominantMiss: MissDirection = 'mixed';
  if (totalMiss > 0) {
    const leftRatio   = totalLeft   / totalMiss;
    const rightRatio  = totalRight  / totalMiss;
    const centerRatio = totalCenter / totalMiss;
    if (leftRatio   > 0.45) dominantMiss = 'left';
    else if (rightRatio  > 0.45) dominantMiss = 'right';
    else if (centerRatio > 0.45) dominantMiss = 'center';
  }

  // Consistency: how often does the round's dominant miss match the overall dominant miss
  let matchCount = 0;
  rounds.forEach((r) => {
    const roundLeft  = r.leftCount  ?? 0;
    const roundRight = r.rightCount ?? 0;
    const roundCtr   = r.centerCount ?? 0;
    const max = Math.max(roundLeft, roundRight, roundCtr);
    let roundDominant: MissDirection = 'mixed';
    if (max > 0) {
      if (roundLeft  === max) roundDominant = 'left';
      else if (roundRight === max) roundDominant = 'right';
      else if (roundCtr   === max) roundDominant = 'center';
    }
    if (roundDominant === dominantMiss) matchCount++;
  });
  const consistencyScore = Math.round((matchCount / n) * 100);

  // ── Club bias ────────────────────────────────────────────────────────────
  const roundsWithBias = rounds.filter((r) => r.avgClubDiff != null);
  let avgClubDiff = 0;
  if (roundsWithBias.length > 0) {
    avgClubDiff =
      roundsWithBias.reduce((sum, r) => sum + (r.avgClubDiff ?? 0), 0) /
      roundsWithBias.length;
  }
  const clubBias: ClubBias = {
    avgClubDiff,
    direction:
      avgClubDiff > NEUTRAL_THRESHOLD
        ? 'up'
        : avgClubDiff < -NEUTRAL_THRESHOLD
        ? 'down'
        : 'neutral',
  };

  // ── Improvement trend ────────────────────────────────────────────────────
  const roundsWithScore = rounds.filter((r) => r.performanceScore != null);
  let improvement: ImprovementTrend = { direction: 'steady', scoreDelta: 0, hasData: false };
  if (roundsWithScore.length >= MIN_ROUNDS) {
    const half = Math.floor(roundsWithScore.length / 2);
    const older  = roundsWithScore.slice(0, half);
    const recent = roundsWithScore.slice(-half);
    const avgOlder  = older.reduce((s, r) => s + (r.performanceScore ?? 0), 0) / older.length;
    const avgRecent = recent.reduce((s, r) => s + (r.performanceScore ?? 0), 0) / recent.length;
    const delta = avgRecent - avgOlder; // positive = improving
    improvement = {
      direction: delta >= 5 ? 'improving' : delta <= -5 ? 'declining' : 'steady',
      scoreDelta: Math.round(delta),
      hasData: true,
    };
  }

  // ── Misc ─────────────────────────────────────────────────────────────────
  const avgShots = Math.round(rounds.reduce((s, r) => s + (r.shots ?? 0), 0) / n);

  // Most used club across rounds
  const clubCounts: Record<string, number> = {};
  rounds.forEach((r) => {
    if (r.topClub) clubCounts[r.topClub] = (clubCounts[r.topClub] ?? 0) + 1;
  });
  const topClub =
    Object.entries(clubCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  return {
    roundCount: n,
    dominantMiss,
    clubBias,
    improvement,
    avgShots,
    topClub,
    consistencyScore,
  };
}
