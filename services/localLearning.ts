/**
 * localLearning.ts
 *
 * In-round and cross-round local learning — NO AI calls, NO async during play.
 *
 * Two responsibilities:
 *
 *  1. deriveLocalBias(shots)
 *     Called live from caddie.tsx on each new shot.
 *     Returns miss bias + confidence from current round's shots only.
 *     Requires MIN_SHOTS before any bias is surfaced.
 *     Recent shots weighted 2x so last-few holes dominate.
 *
 *  2. buildRoundSummary(shots) / deriveHistoricalBias(history)
 *     Called once at round end.
 *     Computes a compact summary stored in aiProfileStore.roundHistory.
 *     deriveHistoricalBias weights last 3 rounds 3x vs older rounds.
 *     Used by buildRecommendation when tier === 'advanced'.
 *
 * Rules:
 *  - MIN_SHOTS = 8  before any bias surfaces (prevents premature steering)
 *  - Confidence: null → low → medium → high as shot count + dominance grows
 *  - Max 5 rounds kept in history (oldest dropped automatically)
 */

import type { Shot } from '../store/roundStore';
import type { MissBias, AiConfidence } from '../store/aiProfileStore';
import type { RoundAnalysis } from '../features/smartCaddie/engine/RoundAnalysis';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const MIN_SHOTS     = 8;  // minimum directional shots before bias is surfaced
const RECENT_WINDOW = 5;  // last N shots in current round weighted 2x
const MAX_HISTORY   = 5;  // rounds stored for historical decay

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface LocalBiasResult {
  missBias: MissBias;
  confidence: AiConfidence;
}

/** Compact summary stored per round for cross-round decay analysis. */
export interface RoundSummary {
  date: string;         // ISO timestamp of round end
  shots: number;        // total shots
  leftCount: number;
  rightCount: number;
  centerCount: number;
  topClub: string | null;
  /** From RoundAnalysis — positive = player clubbed up vs recommendation */
  avgClubDiff?: number;
  /** 0–100 performance score from RoundAnalysis */
  performanceScore?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// In-round bias derivation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * deriveLocalBias — derive miss bias from current-round shots.
 *
 * Pure, synchronous, < 0.1 ms.
 * Returns { missBias: null, confidence: null } when data is insufficient.
 */
export function deriveLocalBias(shots: Shot[]): LocalBiasResult {
  const directional = shots.filter(
    (s) => s.result === 'left' || s.result === 'right' || s.result === 'center',
  );

  if (directional.length < MIN_SHOTS) {
    return { missBias: null, confidence: null };
  }

  let leftScore  = 0;
  let rightScore = 0;
  const total = directional.length;

  // Weight recent shots 2x — last RECENT_WINDOW entries
  directional.forEach((shot, i) => {
    const weight = i >= total - RECENT_WINDOW ? 2 : 1;
    if (shot.result === 'left')  leftScore  += weight;
    if (shot.result === 'right') rightScore += weight;
  });

  const gap = Math.abs(rightScore - leftScore);

  if (rightScore > leftScore && gap >= 4) {
    return { missBias: 'right', confidence: gap >= 8 ? 'high' : 'medium' };
  }
  if (leftScore > rightScore && gap >= 4) {
    return { missBias: 'left', confidence: gap >= 8 ? 'high' : 'medium' };
  }
  if (directional.length >= 12) {
    return { missBias: 'straight', confidence: 'medium' };
  }
  return { missBias: null, confidence: 'low' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Round summary (called once at round end, not during play)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * buildRoundSummary — compact summary for persistence.
 * Call this when the round ends before calling aiProfileStore.addRoundHistory().
 * Pass `analysis` (from analyzeRound) to enrich with club-diff + performance score.
 */
export function buildRoundSummary(shots: Shot[], analysis?: RoundAnalysis | null): RoundSummary {
  const leftCount   = shots.filter((s) => s.result === 'left').length;
  const rightCount  = shots.filter((s) => s.result === 'right').length;
  const centerCount = shots.filter((s) => s.result === 'center').length;

  // Most-used club this round
  const clubCounts: Record<string, number> = {};
  for (const s of shots) {
    if (s.club) clubCounts[s.club] = (clubCounts[s.club] ?? 0) + 1;
  }
  const topClub =
    Object.entries(clubCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  return {
    date: new Date().toISOString(),
    shots: shots.length,
    leftCount,
    rightCount,
    centerCount,
    topClub,
    ...(analysis != null && {
      avgClubDiff:     analysis.avgClubDiff,
      performanceScore: analysis.performanceScore,
    }),
  };
}

/**
 * deriveHistoricalBias — decay-weighted cross-round miss bias.
 *
 * - Last 3 rounds weighted 3x
 * - Older rounds weighted 1x
 * - Requires ≥ 20 weighted shots before surfacing any bias
 *
 * Used in advanced tier only.
 */
export function deriveHistoricalBias(history: RoundSummary[]): LocalBiasResult {
  if (!history || history.length === 0) {
    return { missBias: null, confidence: null };
  }

  const recent = history.slice(-MAX_HISTORY);
  let leftScore  = 0;
  let rightScore = 0;
  let totalWeighted = 0;

  recent.forEach((r, i) => {
    const weight = i >= recent.length - 3 ? 3 : 1; // last 3 rounds = 3x
    leftScore     += r.leftCount  * weight;
    rightScore    += r.rightCount * weight;
    totalWeighted += r.shots      * weight;
  });

  if (totalWeighted < 20) return { missBias: null, confidence: null };

  const total = leftScore + rightScore;
  if (total === 0) return { missBias: 'straight', confidence: 'low' };

  const rightRatio = rightScore / total;
  const leftRatio  = leftScore  / total;

  if (rightRatio > 0.58) {
    return { missBias: 'right', confidence: rightRatio > 0.68 ? 'high' : 'medium' };
  }
  if (leftRatio > 0.58) {
    return { missBias: 'left', confidence: leftRatio > 0.68 ? 'high' : 'medium' };
  }
  return { missBias: 'straight', confidence: 'medium' };
}
