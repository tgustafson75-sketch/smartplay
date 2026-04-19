/**
 * services/visionPipeline.ts
 *
 * Orchestrates the full image-to-precision-engine pipeline.
 *
 * Pipeline:
 *   classifyImage → (camera) processCameraImage → runPrecisionEngine
 *                 → (screenshot) runPrecisionEngine directly
 */

import { classifyImage } from '../utils/imageClassifier';
import { processCameraImage } from '../engine/cameraVision';
import { requireCurrentHole } from '../state/holeStore';
import { runPrecisionEngine } from '../engine/precisionEngine';
import type { PrecisionEngineResult } from '../engine/precisionEngine';

export const runVisionPipeline = async (uri: string): Promise<PrecisionEngineResult> => {
  const type = await classifyImage(uri);
  const holeData = requireCurrentHole();

  if (type === 'screenshot') {
    return runPrecisionEngine({
      inputType: 'screenshot',
      holeData,
    });
  }

  const visionData = await processCameraImage(uri);

  return runPrecisionEngine({
    inputType: 'camera',
    holeData,
    visionData,
  });
};
