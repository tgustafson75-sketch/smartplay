/**
 * features/smartCaddie/engine/CombinedPlayerModel.ts
 *
 * Merges the long-term learned model (PlayerLearning) with the short-term
 * "today swing" model (TodaySwing) into a single profile used by the engine.
 *
 * Today overrides long-term when there is enough data (hasData = true).
 */

import type { LearnedPlayerModel } from './PlayerLearning';
import type { TodaySwingModel }    from './TodaySwing';
import type { MissSide, DistanceBias } from '../hooks/usePlayerModel';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface CombinedPlayerModel {
  /** Net club shift to apply (positive = take stronger club) */
  clubBias: number;
  /** Dominant miss direction (today overrides long-term) */
  miss: MissSide;
  /** Distance bias expressed as DistanceBias string */
  distanceBias: DistanceBias;
}

// ─────────────────────────────────────────────────────────────────────────────
// Combiner
// ─────────────────────────────────────────────────────────────────────────────

export const combineModels = (
  longTerm: LearnedPlayerModel,
  today:    TodaySwingModel,
): CombinedPlayerModel => {
  // Club bias: add today's distance signal to long-term bias
  const clubBias = longTerm.clubBias + today.distanceBias;

  // Miss: today wins when it has data, otherwise fall back to long-term
  const miss: MissSide =
    today.hasData && today.miss != null ? today.miss : longTerm.miss;

  // DistanceBias: today wins when active, otherwise long-term
  const distanceBias: DistanceBias =
    today.hasData && today.distanceBias !== 0
      ? today.distanceBias === 1 ? 'long' : 'short'
      : longTerm.distanceBias;

  return { clubBias, miss, distanceBias };
};
