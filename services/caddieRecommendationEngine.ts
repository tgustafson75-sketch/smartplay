/**
 * caddieRecommendationEngine.ts
 *
 * Pure, synchronous recommendation pipeline.
 *
 *   No AI calls during gameplay.
 *   No async/await.
 *   O(1) per recommendation — always instant.
 *
 * Experience tiers (based on rounds played):
 *   basic    (0–2 rounds)  — yardage + club only
 *   adaptive (3–9 rounds)  — + miss bias adjustment
 *   advanced (10+ rounds)  — + hole memory + round context + AI profile hint
 *
 * Confidence gate:
 *   Bias adjustments are only applied when confidence === 'medium' | 'high'.
 *   'low' confidence falls back to simpler phrasing silently.
 *
 * Usage:
 *   const reco = buildRecommendation({ yardage, club, par, ... });
 *   setCaddieMsg(reco);
 */

import type { AiPlayerProfile } from '../store/aiProfileStore';
import type { HoleMemory } from '../store/memoryStore';
import type { AiConfidence, MissBias } from '../store/aiProfileStore';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ExperienceTier = 'basic' | 'adaptive' | 'advanced';

export interface RecoInput {
  yardage: number;
  club: string;
  par: number;
  holeNumber: number;
  roundsPlayed: number;
  // In-round miss bias (from deriveLocalBias — no AI)
  localMissBias: MissBias;
  localBiasConfidence: AiConfidence;
  // AI profile (from post-round analysis — confidence gated)
  aiProfile: AiPlayerProfile;
  // Per-hole course memory (persisted across rounds)
  holeMemory: HoleMemory | null;
  // Round context
  goalMode: 'beginner' | 'break90' | 'break80';
  strategyMode: 'safe' | 'neutral' | 'attack';
  shotsThisRound: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tier logic
// ─────────────────────────────────────────────────────────────────────────────

/** Returns experience tier based on completed rounds. */
export function getExperienceTier(rounds: number): ExperienceTier {
  if (rounds < 3)  return 'basic';
  if (rounds < 10) return 'adaptive';
  return 'advanced';
}

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline steps (pure functions, append-only — never contradict previous step)
// ─────────────────────────────────────────────────────────────────────────────

function _base(yardage: number, club: string): string {
  if (yardage <= 50)   return `${yardage} yards. Chip — pick your landing zone.`;
  if (yardage <= 100)  return `${yardage} yards. ${club} — focus on landing zone.`;
  if (yardage <= 150)  return `${yardage} yards. ${club} — commit and stay smooth.`;
  if (yardage <= 200)  return `${yardage} yards. ${club} — full tempo.`;
  return `${yardage} yards. ${club} — play center green.`;
}

/** Adds a subtle target-direction hint based on miss bias.
 *  Only modifies target direction phrasing, never changes club. */
function _applyBias(reco: string, bias: MissBias, confidence: AiConfidence): string {
  // Require at least medium confidence before steering the player
  if (!bias || !confidence || confidence === 'low') return reco;
  if (bias === 'right') return `${reco} Aim a touch left.`;
  if (bias === 'left')  return `${reco} Start it right, let it come back.`;
  return reco;
}

/** Adjusts phrasing if hole-specific miss history exceeds 50% to one side. */
function _applyHoleMemory(reco: string, mem: HoleMemory | null): string {
  if (!mem || mem.totalShots < 3) return reco;
  const { totalShots, missesLeft, missesRight } = mem;
  if (missesRight / totalShots > 0.55) return `${reco} You've been missing right here — stay left.`;
  if (missesLeft  / totalShots > 0.55) return `${reco} You've been missing left here — stay right.`;
  return reco;
}

/** Adds one contextual phrase based on round phase + goal/strategy mode. */
function _applyRoundContext(
  reco: string,
  goalMode: RecoInput['goalMode'],
  strategyMode: RecoInput['strategyMode'],
  shotsThisRound: number,
): string {
  const phase = shotsThisRound < 20 ? 'early' : shotsThisRound < 45 ? 'mid' : 'late';
  if (strategyMode === 'attack' && phase !== 'late') return `${reco} Play to the flag.`;
  if (strategyMode === 'safe')                       return `${reco} Play center green.`;
  if (goalMode === 'break90' && phase === 'late')    return `${reco} Par saves the round.`;
  return reco;
}

/** Blends AI profile hint — per-club or global, medium/high confidence only.
 *  Max 5 extra words. Never overrides club selection. */
function _applyAiProfile(reco: string, aiProfile: AiPlayerProfile, club: string): string {
  if (!aiProfile.confidence || aiProfile.confidence === 'low') return reco;
  // Per-club tip takes priority
  const clubAdj = aiProfile.clubAdjustments?.[club];
  if (clubAdj) return `${reco} ${clubAdj.replace(/\.$/, '')}.`;
  // Global miss bias hint (only high confidence — adaptive tier already handled medium)
  if (aiProfile.confidence === 'high' && aiProfile.missBias === 'right') return `${reco} Favor left.`;
  if (aiProfile.confidence === 'high' && aiProfile.missBias === 'left')  return `${reco} Favor right.`;
  return reco;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────

/**
 * buildRecommendation — full tiered pipeline.
 *
 * Always returns a plain string.
 * Always synchronous, always < 1 ms.
 * Safe to call on every render (pure, no side-effects).
 */
export function buildRecommendation(data: RecoInput): string {
  const tier = getExperienceTier(data.roundsPlayed);

  let reco = _base(data.yardage, data.club);

  // Adaptive+: apply in-round local bias (no AI needed)
  if (tier === 'adaptive' || tier === 'advanced') {
    reco = _applyBias(reco, data.localMissBias, data.localBiasConfidence);
  }

  // Advanced only: layer in hole memory, round context, AI profile
  if (tier === 'advanced') {
    reco = _applyHoleMemory(reco, data.holeMemory);
    reco = _applyRoundContext(reco, data.goalMode, data.strategyMode, data.shotsThisRound);
    reco = _applyAiProfile(reco, data.aiProfile, data.club);
  }

  return reco;
}
