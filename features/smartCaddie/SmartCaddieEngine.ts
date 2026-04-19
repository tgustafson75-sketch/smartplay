/**
 * features/smartCaddie/SmartCaddieEngine.ts
 *
 * Core decision engine — pure functions that combine hole context,
 * player model, and yardage into a concrete CaddieDecision.
 *
 * No React dependencies; can be called from hooks or background workers.
 */

import type { CourseHole } from '../../data/courses';
import type { ShotPattern } from './data/shotPatterns';
import { makeCaddieDecision, getMissReminder, generateAdvice } from './utils/decisionRules';
import { getBucketMeta, adjustedYardage } from './utils/distanceBuckets';
import type { CaddieDecision, DecisionInput } from './utils/decisionRules';
import { lakesHoles } from './data/lakesHoles';
import type { LakesHoleMeta } from './data/lakesHoles';
import type { PlayerTendencies } from './hooks/usePlayerModel';
import { recommendClub } from './engine/ClubEngine';
import type { ClubName } from './types/club';
import { selectBestTarget, generateDecisionText, generatePersonalAdvice } from './engine/TargetSelector';
import type { HazardDistance } from './engine/RiskEngine';
import { calculateConfidence } from './engine/ConfidenceEngine';
import type { ConfidenceLevel } from './engine/ConfidenceEngine';
import { calculatePressure } from './engine/PressureEngine';
import type { PressureLevel } from './engine/PressureEngine';
import { modifyDecision } from './engine/DecisionModifier';
import type { PlayStyle } from './engine/DecisionModifier';
import type { RoundShot } from './hooks/useRoundStore';
import { buildDispersion } from './engine/DispersionModel';
import { predictShot } from './engine/ShotPrediction';
import type { PredictedMiss } from './engine/ShotPrediction';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface EngineInput {
  /** GPS or manual yardage to the middle of the green */
  yardage: number;
  /** Current hole data */
  hole: CourseHole;
  /** Player shot pattern from this session */
  missPattern: ShotPattern;
  /** Strategy mode chosen by user */
  strategyMode: 'safe' | 'neutral' | 'attack';
  /** Score vs par this round */
  scoreVsPar: number;
  /** Club recommended by player model */
  recommendedClub: string;
  /** Optional environmental adjustments */
  elevationFt?: number;
  windMph?: number;
  tempF?: number;
}

export interface EngineOutput {
  /** Full decision record */
  decision: CaddieDecision;
  /** Yardage after environmental adjustment */
  adjustedYards: number;
  /** Distance bucket label */
  bucketLabel: string;
  /** Caddie voice line */
  voiceHint: string;
  /** Short reminder about current miss tendency */
  missReminder: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run the SmartCaddie engine for a single shot situation.
 * Returns a EngineOutput with all display and voice data.
 */
export function runSmartCaddieEngine(input: EngineInput): EngineOutput {
  const {
    yardage,
    hole,
    missPattern,
    strategyMode,
    scoreVsPar,
    recommendedClub,
    elevationFt,
    windMph,
    tempF,
  } = input;

  // Adjust raw yardage for environment
  const adjustedYards = adjustedYardage({ rawYards: yardage, elevationFt, windMph, tempF });

  // Bucket metadata
  const bucketMeta = getBucketMeta(adjustedYards);

  // Decision
  const decisionInput: DecisionInput = {
    hole,
    yardage: adjustedYards,
    par:     hole.par,
    strategyMode,
    missPattern,
    scoreVsPar,
    recommendedClub,
  };

  const decision = makeCaddieDecision(decisionInput);

  // Miss reminder
  const missReminder = getMissReminder(missPattern.dominantMiss, missPattern.missConfidence);

  return {
    decision,
    adjustedYards,
    bucketLabel:  bucketMeta.label,
    voiceHint:    bucketMeta.voiceHint,
    missReminder,
  };
}

/**
 * Generate a pre-round brief string summarizing the course risk
 * across all holes with water or out-of-bounds.
 */
export function generateRoundBrief(holes: CourseHole[]): string {
  const waterCount = holes.filter(
    (h) => h.hazards?.some((z) => z.type === 'water') || h.note.toLowerCase().includes('water')
  ).length;
  const obCount = holes.filter(
    (h) => h.hazards?.some((z) => z.type === 'ob')
  ).length;

  const lines: string[] = [];
  if (waterCount > 0) lines.push(`${waterCount} hole${waterCount > 1 ? 's' : ''} with water in play`);
  if (obCount    > 0) lines.push(`${obCount} hole${obCount > 1 ? 's' : ''} with OB exposure`);
  if (lines.length === 0) return 'Clean course — no major hazard holes.';
  return lines.join(' · ') + '. Play smart early.';
}

// ─────────────────────────────────────────────────────────────────────────────
// SmartCaddieEngine — primary callable used by useSmartCaddie hook and UI
// ─────────────────────────────────────────────────────────────────────────────

export interface SmartCaddieEngineInput {
  holeNumber: number;
  distance: number;
  player: { tendencies: PlayerTendencies };
  /** Optional player adaptation offset from PlayerAdaptation.getClubAdjustment() */
  adjustment?: number;
  /** Active hazards with their current distance from the player (yards) */
  hazards?: HazardDistance[];
  /** Shots from the current round (for confidence + pressure) */
  roundShots?: RoundShot[];
}

export interface SmartCaddieEngineResult {
  hole: LakesHoleMeta | undefined;
  distance: number;
  advice: string;
  /** Auto-recommended club based on distance. */
  recommendedClub: ClubName;
  /** Best landing target yardage (modified by confidence/pressure/dispersion) */
  target: number;
  /** Risk score for the chosen target (0 = clean) */
  risk: number;
  /** Confidence level derived from last 5 round shots */
  confidence: ConfidenceLevel;
  /** Pressure level (late round or bad streak) */
  pressure: PressureLevel;
  /** Play style adjusted by confidence/pressure */
  style: PlayStyle;
  /** Predicted most likely miss from dispersion model */
  predictedMiss: PredictedMiss;
}

/**
 * Primary engine entry point.
 * Looks up hole metadata from the Lakes course and runs the insight engine
 * to produce a single actionable advice string.
 */
export const SmartCaddieEngine = ({
  holeNumber,
  distance,
  player,
  adjustment = 0,
  hazards = [],
  roundShots = [],
}: SmartCaddieEngineInput): SmartCaddieEngineResult => {
  const hole = lakesHoles[holeNumber];

  // Build a PlayerProfile from player tendencies for risk-aware scoring
  const playerProfile = {
    miss:         player.tendencies.miss,
    distanceBias: player.tendencies.distanceBias,
  };

  const bestTarget = selectBestTarget(distance, hazards, playerProfile);

  // Dispersion model
  const dispersion   = buildDispersion(roundShots);
  const prediction   = predictShot(dispersion);

  // Confidence + Pressure layer
  const confidence = calculateConfidence(roundShots);
  const pressure   = calculatePressure({ holeNumber, roundShots });
  // Apply dispersion offset on top of confidence/pressure modifier
  const modified   = modifyDecision({ baseTarget: bestTarget.yardage + prediction.targetOffset, confidence, pressure });

  // Blend tone into advice
  const personalAdvice = generatePersonalAdvice(bestTarget.label, playerProfile, hazards);
  const advice = `${modified.tone} ${personalAdvice}`.trim();

  return {
    hole,
    distance,
    advice,
    recommendedClub: recommendClub(distance, adjustment),
    target:        modified.target,
    risk:          bestTarget.risk,
    confidence,
    pressure,
    style:         modified.style,
    predictedMiss: prediction.predictedMiss,
  };
};
