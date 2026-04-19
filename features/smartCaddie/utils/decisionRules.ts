/**
 * features/smartCaddie/utils/decisionRules.ts
 *
 * Pure decision-rule functions that map hole data + player profile
 * to a caddie strategy recommendation.
 *
 * All functions are side-effect free — outputs depend only on inputs.
 */

import type { CourseHole } from '../../../data/courses';
import type { ShotPattern, MissDirection } from '../data/shotPatterns';
import { classifyDistance, getDistanceBucket } from './distanceBuckets';
import type { LakesHoleMeta } from '../data/lakesHoles';
import type { PlayerTendencies } from '../hooks/usePlayerModel';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type PlayStrategy = 'safe' | 'normal' | 'aggressive';

export interface CaddieDecision {
  /** Overall play strategy for the shot */
  strategy: PlayStrategy;
  /** Recommended club name */
  club: string;
  /** Aim target — adjusted for miss bias */
  aimTarget: 'left' | 'center' | 'right';
  /** Short caddie message for the UI */
  message: string;
  /** One-word label for display in StrategyBadge */
  strategyLabel: string;
  /** Risk level 1 (low) – 5 (high) */
  riskLevel: number;
  /** Whether a hazard is directly in the miss direction */
  hazardInMissLine: boolean;
}

export interface DecisionInput {
  hole: CourseHole;
  yardage: number;
  par: number;
  strategyMode: 'safe' | 'neutral' | 'attack';
  missPattern: ShotPattern;
  /** Score relative to par so far this round (+2 = 2 over) */
  scoreVsPar: number;
  /** Recommended club from player model */
  recommendedClub: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Main entry point — returns a full caddie decision for a given shot context.
 */
export function makeCaddieDecision(input: DecisionInput): CaddieDecision {
  const { hole, yardage, strategyMode, missPattern, scoreVsPar, recommendedClub } = input;

  const bucket = classifyDistance(yardage);
  const dominantMiss = missPattern.dominantMiss;
  const hasHazardInMissLine = _hazardInMissLine(hole, dominantMiss);

  // --- Strategy selection --------------------------------------------------
  const strategy = _selectStrategy({
    strategyMode,
    bucket,
    scoreVsPar,
    hasHazardInMissLine,
    missConfidence: missPattern.missConfidence,
    recentTrend: missPattern.recentTrend,
  });

  // --- Aim target ----------------------------------------------------------
  const aimTarget = _computeAimTarget({ dominantMiss, hole, strategy });

  // --- Message -------------------------------------------------------------
  const message = _buildMessage({ hole, strategy, aimTarget, dominantMiss, yardage, bucket });

  // --- Risk level ---------------------------------------------------------
  const riskLevel = _computeRiskLevel({ strategy, hasHazardInMissLine, bucket });

  const strategyLabels: Record<PlayStrategy, string> = {
    safe:       'Safe',
    normal:     'Play It',
    aggressive: 'Attack',
  };

  return {
    strategy,
    club: recommendedClub,
    aimTarget,
    message,
    strategyLabel: strategyLabels[strategy],
    riskLevel,
    hazardInMissLine: hasHazardInMissLine,
  };
}

/**
 * Returns a one-line pre-shot reminder based on the player's miss pattern.
 * Intended for the CaddieCard subtext.
 */
export function getMissReminder(dominantMiss: MissDirection, confidence: number): string {
  if (!dominantMiss || confidence < 0.35) return 'Pick a target and commit.';
  if (dominantMiss === 'left') {
    return confidence >= 0.6
      ? 'Aim right of center — you tend to pull left.'
      : 'Slight left miss trend — stay through the ball.';
  }
  return confidence >= 0.6
    ? 'Aim left of center — you tend to push right.'
    : 'Slight right miss trend — check your face at impact.';
}

// ─────────────────────────────────────────────────────────────────────────────
// Private helpers
// ─────────────────────────────────────────────────────────────────────────────

function _hazardInMissLine(hole: CourseHole, miss: MissDirection): boolean {
  if (!miss || !hole.hazards) return false;
  return hole.hazards.some((hz) => {
    if (hz.type === 'water' || hz.type === 'ob') {
      // Miss left and hazard is on the left side (x < 0.4)
      if (miss === 'left'  && hz.x < 0.4)  return true;
      // Miss right and hazard is on the right side (x > 0.6)
      if (miss === 'right' && hz.x > 0.6)  return true;
    }
    return false;
  });
}

function _selectStrategy(params: {
  strategyMode: 'safe' | 'neutral' | 'attack';
  bucket: ReturnType<typeof classifyDistance>;
  scoreVsPar: number;
  hasHazardInMissLine: boolean;
  missConfidence: number;
  recentTrend: ShotPattern['recentTrend'];
}): PlayStrategy {
  const { strategyMode, bucket, scoreVsPar, hasHazardInMissLine, missConfidence, recentTrend } = params;

  // Hard override: hazard in miss line always forces safe
  if (hasHazardInMissLine && missConfidence >= 0.5) return 'safe';

  // Struggling trend → tone it down
  if (recentTrend === 'struggling') {
    if (strategyMode === 'attack') return 'normal';
    return 'safe';
  }

  // user-chosen strategy mode is the baseline
  if (strategyMode === 'safe') return 'safe';
  if (strategyMode === 'attack') {
    // Don't go aggressive from long distance
    if (bucket === 'driver' || bucket === 'fairway') return 'normal';
    return 'aggressive';
  }

  // neutral — contextual
  if (scoreVsPar >= 3) return 'safe';           // struggling badly → safe
  if (scoreVsPar <= -1 && recentTrend === 'improving') return 'aggressive'; // hot round
  return 'normal';
}

function _computeAimTarget(params: {
  dominantMiss: MissDirection;
  hole: CourseHole;
  strategy: PlayStrategy;
}): 'left' | 'center' | 'right' {
  const { dominantMiss, hole, strategy } = params;

  // No bias data or safe play → aim center
  if (!dominantMiss || strategy === 'safe') return 'center';

  // If the hazard avoidDir from hole data contradicts our bias adjustment, defer to hole
  const primaryHazard = hole.hazards?.find((hz) => hz.type === 'water' || hz.type === 'ob');
  if (primaryHazard) return primaryHazard.avoidDir === 'left' ? 'left' : primaryHazard.avoidDir === 'right' ? 'right' : 'center';

  // Aim away from dominant miss
  if (dominantMiss === 'left')  return 'right';
  if (dominantMiss === 'right') return 'left';
  return 'center';
}

function _buildMessage(params: {
  hole: CourseHole;
  strategy: PlayStrategy;
  aimTarget: 'left' | 'center' | 'right';
  dominantMiss: MissDirection;
  yardage: number;
  bucket: ReturnType<typeof classifyDistance>;
}): string {
  const { hole, strategy, aimTarget, dominantMiss, yardage, bucket } = params;

  const note = hole.note ?? '';
  const aimLabel = aimTarget === 'center' ? 'center' : `${aimTarget} of center`;

  if (strategy === 'safe') {
    if (note.toLowerCase().includes('water') || note.toLowerCase().includes('lake')) {
      return `Water in play — aim ${aimLabel} and take the safe number.`;
    }
    return `Play safe. Aim ${aimLabel}, ${yardage} yds.`;
  }

  if (strategy === 'aggressive') {
    return `Go for it — attack the flag. ${yardage} yds, commit fully.`;
  }

  // normal
  if (dominantMiss === 'left') {
    return `${yardage} yds. Aim ${aimLabel} — trust your swing.`;
  }
  if (dominantMiss === 'right') {
    return `${yardage} yds. Aim ${aimLabel} to protect right miss.`;
  }
  if (bucket === 'wedge') return `${yardage} yds. Soft hands, let the loft work.`;
  if (bucket === 'driver') return `${yardage} yds. Smooth swing, pick a landing zone.`;
  return `${yardage} yds to the middle. Commit and go.`;
}

function _computeRiskLevel(params: {
  strategy: PlayStrategy;
  hasHazardInMissLine: boolean;
  bucket: ReturnType<typeof classifyDistance>;
}): number {
  const { strategy, hasHazardInMissLine, bucket } = params;
  let base = strategy === 'safe' ? 1 : strategy === 'aggressive' ? 4 : 2;
  if (hasHazardInMissLine) base = Math.min(5, base + 1);
  if (bucket === 'driver')  base = Math.min(5, base + 1);
  return base;
}

// ─────────────────────────────────────────────────────────────────────────────
// Insight engine — generateAdvice
// ─────────────────────────────────────────────────────────────────────────────

export interface GenerateAdviceInput {
  hole: LakesHoleMeta;
  distance: number;
  player: { tendencies: PlayerTendencies };
}

/**
 * Core insight engine — returns a single, actionable caddie sentence.
 *
 * Priority order:
 *   1. Player weakness override (partial wedge struggles)
 *   2. Hole-specific risk type
 *   3. Scoring hole opportunity
 *   4. Default fallback
 */
export const generateAdvice = ({ hole, distance, player }: GenerateAdviceInput): string => {
  const bucket = getDistanceBucket(distance);

  // 1. Player weakness override
  if (player.tendencies.strugglesWithPartialWedges) {
    if (bucket === 'danger_zone' || bucket === 'partial_wedge') {
      return 'Avoid this distance. Play to 120–140 yards.';
    }
  }

  // 2. Hole-specific logic
  if (hole.type === 'risk_water_right') {
    return 'Aim left-center. Commit. Do not leak right.';
  }

  if (hole.type === 'risk_water_left') {
    return 'Aim right-center. Stay away from the left edge.';
  }

  if (hole.type === 'water_right_narrow') {
    return 'Favor left side. Accuracy over distance.';
  }

  if (hole.type === 'long_par4') {
    return 'This is a 2-shot hole. Stay below the hole.';
  }

  if (hole.type === 'reachable_par5') {
    return 'Decide early: go for it or lay up smart. No hesitation.';
  }

  if (hole.type === 'risk_reward') {
    return 'Pick a strategy: go for it or lay up clean. No in-between.';
  }

  if (hole.type === 'scoring_par3') {
    return 'Par 3 scoring hole. Pick a precise target and commit fully.';
  }

  if (hole.type === 'scoring_par5') {
    return 'Eagle opportunity. Smart layup puts you in range for a look.';
  }

  // 3. Scoring hole (fallback for any type flagged as scoring)
  if (hole.scoring) {
    return 'Scoring hole. Full commitment swing.';
  }

  // 4. Default
  return 'Smooth swing. Target center green.';
};
