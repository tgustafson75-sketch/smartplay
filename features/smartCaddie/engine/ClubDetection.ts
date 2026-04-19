/**
 * features/smartCaddie/engine/ClubDetection.ts
 *
 * Predicts the club most likely used for a detected shot.
 *
 * ── ALGORITHM ──────────────────────────────────────────────────────────────
 *
 *  1. Apply context overrides first (tee shot → Driver, on-green → Putter,
 *     very-short shot → LW/SW).
 *  2. Score every club the player has in their bag using the player-specific
 *     distances from bagStore (falling back to DEFAULT_DISTANCES when a club
 *     hasn't been played yet).
 *  3. Pick the closest match; compute a confidence score (0–1).
 *
 * ── CONFIDENCE SCORE ───────────────────────────────────────────────────────
 *   ≥0.9  — within  5 yds of known average
 *    0.7  — within 10 yds
 *    0.5  — within 20 yds
 *    0.3  — further than 20 yds (likely off-day, partial swing, etc.)
 *
 * ── CONTEXT ADJUSTMENTS ────────────────────────────────────────────────────
 *   teeShot  (hole par ≥ 4, shot index 1)   → Driver
 *   onGreen  (distance ≤ 5 yds)             → Putter (not in CLUBS! use 'LW' as proxy)
 *   shortGame (distance ≤ 30 yds)           → SW or LW (closest short wedge)
 */

import { DEFAULT_DISTANCES } from '../../../store/bagStore';
import type { ClubName } from '../types/club';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ClubDetectionInput {
  /** Shot distance in yards */
  yards:             number;
  /** Player's known per-club distances (from bagStore.clubDistances merged with defaults) */
  playerDistances:   Partial<Record<ClubName, number>>;
  /** Clubs the player has in their bag (subset of all clubs) */
  bagClubs:          ClubName[];
  /** Contextual hints */
  context?: {
    /** True if this is the first shot on a par-4 or par-5 hole */
    isTeeShot?:   boolean;
    /** True if the player is currently inside the green zone */
    isOnGreen?:   boolean;
  };
}

export interface ClubDetectionResult {
  club:        ClubName;
  confidence:  number;   // 0–1
  /** Yards delta between detected shot and predicted club's average */
  delta:       number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function effectiveDistance(
  club: ClubName,
  playerDistances: Partial<Record<ClubName, number>>,
): number {
  return playerDistances[club] ?? DEFAULT_DISTANCES[club] ?? 0;
}

function confidenceFromDelta(delta: number): number {
  if (delta < 5)  return 0.9;
  if (delta < 10) return 0.7;
  if (delta < 20) return 0.5;
  return 0.3;
}

// ── Main function ─────────────────────────────────────────────────────────────

export function detectClub(input: ClubDetectionInput): ClubDetectionResult {
  const { yards, playerDistances, bagClubs, context = {} } = input;

  // ── Context overrides ───────────────────────────────────────────────────
  if (context.isOnGreen || yards <= 5) {
    // On the green → SW is the closest "short" club in CLUBS (Putter not in list)
    const club: ClubName = 'SW';
    const delta = Math.abs(yards - effectiveDistance(club, playerDistances));
    return { club, confidence: 0.9, delta };
  }

  if (context.isTeeShot) {
    const club: ClubName = 'Driver';
    const avg   = effectiveDistance(club, playerDistances);
    const delta = Math.abs(yards - avg);
    return { club, confidence: confidenceFromDelta(delta), delta };
  }

  if (yards <= 30) {
    // Short game — pick closest from wedge family
    const wedges: ClubName[] = (['LW', 'SW', 'GW', 'PW'] as ClubName[]).filter((c) =>
      bagClubs.includes(c),
    );
    if (wedges.length > 0) {
      let best = wedges[0];
      let bestDelta = Math.abs(yards - effectiveDistance(wedges[0], playerDistances));
      for (const w of wedges.slice(1)) {
        const d = Math.abs(yards - effectiveDistance(w, playerDistances));
        if (d < bestDelta) { bestDelta = d; best = w; }
      }
      return { club: best, confidence: confidenceFromDelta(bestDelta), delta: bestDelta };
    }
  }

  // ── Nearest-distance match across full bag ──────────────────────────────
  const available = bagClubs.length > 0 ? bagClubs : (Object.keys(DEFAULT_DISTANCES) as ClubName[]);

  let bestClub:  ClubName = available[0];
  let bestDelta: number   = Infinity;

  for (const c of available) {
    const avg   = effectiveDistance(c, playerDistances);
    const delta = Math.abs(yards - avg);
    if (delta < bestDelta) { bestDelta = delta; bestClub = c; }
  }

  return {
    club:       bestClub,
    confidence: confidenceFromDelta(bestDelta),
    delta:      bestDelta,
  };
}

// ── Convenience: merge bag distances with defaults ─────────────────────────────

export function resolvePlayerDistances(
  clubDistances: Partial<Record<ClubName, number>>,
): Partial<Record<ClubName, number>> {
  const result: Partial<Record<ClubName, number>> = { ...DEFAULT_DISTANCES };
  for (const [k, v] of Object.entries(clubDistances)) {
    if (v !== undefined) result[k as ClubName] = v;
  }
  return result;
}
