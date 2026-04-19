/**
 * features/smartCaddie/engine/PlayerLearning.ts
 *
 * Builds a lightweight player model from shot history.
 * Requires at least 5 shots before emitting tendencies; returns neutral
 * defaults until then to avoid over-reacting to sparse data.
 *
 * Produces:
 *   miss        — dominant horizontal miss direction (left | right | center)
 *   distanceBias — short | long | neutral
 *   clubBias     — numeric shift to apply to club recommendations
 *                  positive = player consistently takes stronger club
 *                  negative = player consistently takes weaker club
 */

import { CLUBS } from '../types/club';
import type { ClubName }     from '../types/club';
import type { TrackedShot, ShotResult } from '../hooks/useShotTracking';
import type { MissSide, DistanceBias } from '../hooks/usePlayerModel';

export interface LearnedPlayerModel {
  miss:         MissSide;
  distanceBias: DistanceBias;
  /** Fractional club-shift derived from recommended vs selected history */
  clubBias:     number;
  /** True when there is enough data to act on */
  hasTendency:  boolean;
}

const MIN_SHOTS = 5;

export function buildPlayerModel(shots: TrackedShot[]): LearnedPlayerModel {
  if (shots.length < MIN_SHOTS) {
    return { miss: 'center', distanceBias: 'neutral', clubBias: 0, hasTendency: false };
  }

  // ── Miss direction ────────────────────────────────────────────────────────
  const missCount: Record<ShotResult, number> = { left: 0, right: 0, short: 0, long: 0, good: 0 };
  let resultCount = 0;

  for (const s of shots) {
    if (s.result && s.result in missCount) {
      missCount[s.result]++;
      resultCount++;
    }
  }

  let miss: MissSide = 'center';
  if (resultCount >= MIN_SHOTS) {
    const leftRate  = missCount.left  / resultCount;
    const rightRate = missCount.right / resultCount;
    if (rightRate >= 0.35)      miss = 'right';
    else if (leftRate >= 0.35)  miss = 'left';
  }

  // ── Distance bias ─────────────────────────────────────────────────────────
  let distanceBias: DistanceBias = 'neutral';
  if (resultCount >= MIN_SHOTS) {
    const shortRate = missCount.short / resultCount;
    const longRate  = missCount.long  / resultCount;
    if (shortRate >= 0.35)     distanceBias = 'short';
    else if (longRate >= 0.35) distanceBias = 'long';
  }

  // ── Club bias ─────────────────────────────────────────────────────────────
  // Positive = player takes stronger club than recommended
  // Negative = player takes weaker club
  let clubDiffTotal = 0;
  let clubDiffCount = 0;

  for (const s of shots) {
    const recIdx = (CLUBS as readonly ClubName[]).indexOf(s.recommended);
    const selIdx = (CLUBS as readonly ClubName[]).indexOf(s.selected);
    if (recIdx !== -1 && selIdx !== -1) {
      clubDiffTotal += recIdx - selIdx; // lower index = stronger club
      clubDiffCount++;
    }
  }

  const clubBias = clubDiffCount > 0 ? clubDiffTotal / clubDiffCount : 0;

  return { miss, distanceBias, clubBias, hasTendency: true };
}
