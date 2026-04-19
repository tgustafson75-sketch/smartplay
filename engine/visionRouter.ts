/**
 * engine/visionRouter.ts
 *
 * Routes a classified scene to the appropriate precision sub-pipeline
 * and returns a PrecisionDecision. holeData is ALWAYS injected.
 *
 * Pipeline position:
 *   ImageClassifier → THIS → PrecisionEngine → PrecisionView
 */

import type { CourseHole } from '../data/courses';
import { classifyImage } from '../utils/imageClassifier';
import type { ImageClassification, InputSource } from '../utils/imageClassifier';
import { computePrecisionDecision, runPrecisionEngine } from './precisionEngine';
import type { PrecisionInput, PrecisionDecision, PlayerCoords, PrecisionEngineResult } from './precisionEngine';
import { processCameraImage } from './cameraVision';
import { getCurrentHole } from '../state/holeStore';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VisionRouterInput {
  /** Image URI from camera/screenshot, or null for GPS-only mode. */
  uri: string | null;
  /** How the input was obtained. */
  source: InputSource;
  /** Active hole — ALWAYS required. */
  holeData: CourseHole;
  /** Player GPS coords (optional but improves accuracy). */
  playerCoords?: PlayerCoords | null;
  /** Precomputed GPS yardages (optional override). */
  gpsYards?: PrecisionInput['gpsYards'];
  /** Club distances from player profile. */
  clubDistances?: Record<string, number>;
  /** Wind / elevation / lie context. */
  context?: Pick<PrecisionInput, 'windSpeed' | 'windDirection' | 'elevationChange' | 'lie' | 'mentalState' | 'shots' | 'pinPosition'>;
}

// ─── Route Logic ──────────────────────────────────────────────────────────────

/**
 * Determine pin position hint from scene type.
 * Overrides the caller's pinPosition only when we have strong visual evidence.
 */
function inferPinPosition(
  classification: ImageClassification,
  callerPin?: PrecisionInput['pinPosition'],
): PrecisionInput['pinPosition'] {
  if (classification.type === 'green' && classification.confidence >= 0.75) {
    // Player is near the green — use back pin as conservative default
    return callerPin ?? 'middle';
  }
  return callerPin ?? 'middle';
}

// ─── Main Router ──────────────────────────────────────────────────────────────

/**
 * Route a captured input through the precision pipeline and return a decision.
 */
export function routeVision(input: VisionRouterInput): PrecisionDecision {
  const { uri, source, holeData, playerCoords, gpsYards, clubDistances, context = {} } = input;

  // 1. Classify the image (or mark as GPS-only)
  const classification = classifyImage(uri, source);

  // 2. Resolve pin position (scene-aware)
  const pinPosition = inferPinPosition(classification, context.pinPosition);

  // 3. Build precision input — holeData always injected
  const precisionInput: PrecisionInput = {
    holeData,
    playerCoords,
    gpsYards,
    sceneType:       classification.type,
    source:          classification.source,
    clubDistances,
    windSpeed:       context.windSpeed,
    windDirection:   context.windDirection,
    elevationChange: context.elevationChange,
    lie:             context.lie,
    mentalState:     context.mentalState,
    shots:           context.shots,
    pinPosition,
  };

  // 4. Run the engine
  return computePrecisionDecision(precisionInput);
}

// ─── runVisionPipeline ────────────────────────────────────────────────────────

/**
 * High-level async pipeline entry point.
 *
 * Given a captured image URI (from camera or screenshot), this function:
 *   1. Classifies the image to determine the input type.
 *   2. Fetches the current hole from holeStore (throws if none set).
 *   3. For camera mode: runs processCameraImage to extract hazards + depth.
 *   4. Runs the async precisionEngine with the resolved context.
 *
 * @param uri  Local file URI from captureFromCamera or wrapScreenshot.
 */
export const runVisionPipeline = async (uri: string): Promise<PrecisionEngineResult> => {
  // Classify to determine whether this is a camera or screenshot input
  const classification = classifyImage(uri, 'camera');

  const holeData = getCurrentHole();
  if (!holeData) throw new Error('[runVisionPipeline] No hole loaded. Call setCurrentHole() first.');

  // Screenshot path — no CV analysis needed
  if (classification.type === 'scorecard' || classification.source === 'screenshot') {
    return runPrecisionEngine({ inputType: 'screenshot', holeData });
  }

  // Camera path — run image analysis to surface visual hazards + depth
  const visionData = await processCameraImage(uri);

  return runPrecisionEngine({ inputType: 'camera', holeData, visionData });
};
