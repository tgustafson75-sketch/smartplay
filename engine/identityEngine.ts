/**
 * engine/identityEngine.ts
 *
 * Persistent Identity Layer — long-term player profile that evolves
 * across multiple rounds.
 *
 * Operates at a different timescale than memoryEngine (single round)
 * and roundEngine (in-round momentum).  Identity is the cumulative
 * picture: how the player typically plays, what their long-term miss
 * pattern is, and which clubs they reach for.
 *
 * Design rules:
 *   • Identity influences advice only when memory has no stronger signal
 *   • Changes accumulate gradually — single outlier rounds don't flip identity
 *   • No UI fingerprints; advice adjustments are 1–2 word shifts, not rewrites
 */

import type { MemoryProfile } from './memoryEngine';

// ─── Types ────────────────────────────────────────────────────────────────────

export type PlayStyle  = 'aggressive' | 'conservative' | 'neutral';
export type MissBias   = 'left' | 'right' | 'neutral';

export interface IdentityProfile {
  /** Long-term tendency for shot shape / risk appetite */
  playStyle:             PlayStyle;
  /** Dominant long-term miss direction */
  missBias:              MissBias;
  /** Rounds used to build this identity (caps influence growth) */
  roundsContributed:     number;
  /**
   * Player-declared personality preference — null means auto.
   * Stored here so it survives app restarts independently of PersonalityProfile.
   */
  personalityPreference: 'calm' | 'confident' | 'competitive' | null;
  /** ISO timestamp of last update */
  updatedAt:             string;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export const createIdentityProfile = (): IdentityProfile => ({
  playStyle:             'neutral',
  missBias:              'neutral',
  roundsContributed:     0,
  personalityPreference: null,
  updatedAt:             new Date().toISOString(),
});

// ─── Post-round update ────────────────────────────────────────────────────────

/**
 * Merges one round's memory into the long-term identity.
 * Uses a weighted approach — older identity retains influence unless
 * the player has contributed very few rounds.
 */
export const updateIdentity = (
  identity: IdentityProfile,
  memory:   MemoryProfile,
): IdentityProfile => {
  const rounds = identity.roundsContributed + 1;

  // ── Miss bias ──────────────────────────────────────────────────────────────
  // Weight: current round = 1 vote; identity = prior rounds (max weight 10)
  const priorWeight = Math.min(identity.roundsContributed, 10);
  const leftVotes   = priorWeight * (identity.missBias === 'left'  ? 1 : 0)
                    + (memory.tendencies === 'left'  ? 1 : 0);
  const rightVotes  = priorWeight * (identity.missBias === 'right' ? 1 : 0)
                    + (memory.tendencies === 'right' ? 1 : 0);

  let missBias: MissBias = 'neutral';
  if (leftVotes > rightVotes + 1)  missBias = 'left';
  if (rightVotes > leftVotes + 1)  missBias = 'right';

  // ── Play style ─────────────────────────────────────────────────────────────
  // "Aggressive" = player hits lots of shots (>18 per round average)
  const shotCount  = memory.shotHistory?.length ?? 0;
  const avgPerRound = shotCount; // single-round snapshot

  let playStyle: PlayStyle = identity.playStyle;
  if (rounds <= 3) {
    // Not enough data — make a first estimate
    playStyle = avgPerRound > 20 ? 'aggressive' : 'conservative';
  } else if (avgPerRound > 22 && identity.playStyle !== 'aggressive') {
    playStyle = 'aggressive';
  } else if (avgPerRound < 16 && identity.playStyle !== 'conservative') {
    playStyle = 'conservative';
  }

  return {
    ...identity,
    missBias,
    playStyle,
    roundsContributed: rounds,
    updatedAt: new Date().toISOString(),
  };
};

// ─── Context helper ───────────────────────────────────────────────────────────

/**
 * Returns a short insight string based on identity, or null when nothing useful.
 * golfEngine calls this as a *fallback* when memory has no tendency signal.
 */
export const getIdentityInsight = (identity: IdentityProfile): string | null => {
  if (identity.missBias === 'right') return 'Your typical miss is right — favor left.';
  if (identity.missBias === 'left')  return 'Your typical miss is left — favor right.';
  return null;
};
