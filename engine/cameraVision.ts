/**
 * engine/cameraVision.ts
 *
 * Camera capture integration for the Precision Vision pipeline.
 * Wraps expo-camera CameraView ref interactions into a clean async API.
 *
 * Returns a { uri, source } capture result that feeds directly into
 * imageClassifier → visionRouter → precisionEngine.
 */

import { RefObject } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

export type CaptureSource = 'camera' | 'screenshot' | 'gps';

export interface CaptureResult {
  /** Local file URI of the captured image, or null for GPS-only mode. */
  uri: string | null;
  /** How this capture was obtained. */
  source: CaptureSource;
  /** Unix timestamp (ms) of capture. */
  capturedAt: number;
}

/**
 * Minimal shape of an expo-camera CameraView ref.
 * Full import avoided to keep engine layer free of React Native peer deps.
 */
export interface CameraViewRef {
  takePictureAsync(options?: { quality?: number; skipProcessing?: boolean }): Promise<{ uri: string }>;
}

// ─── Capture Helpers ──────────────────────────────────────────────────────────

/**
 * Take a still photo from an active CameraView.
 * Returns a CaptureResult on success, or null on failure.
 */
export async function captureFromCamera(
  cameraRef: RefObject<CameraViewRef | null>
): Promise<CaptureResult | null> {
  const cam = cameraRef.current;
  if (!cam) return null;

  try {
    const photo = await cam.takePictureAsync({ quality: 0.7, skipProcessing: true });
    return {
      uri: photo.uri,
      source: 'camera',
      capturedAt: Date.now(),
    };
  } catch {
    return null;
  }
}

/**
 * Wrap an externally-obtained screenshot URI into a CaptureResult.
 */
export function wrapScreenshot(uri: string): CaptureResult {
  return { uri, source: 'screenshot', capturedAt: Date.now() };
}

/**
 * Produce a GPS-only CaptureResult (no image).
 * Use when the player wants a caddie decision based purely on GPS position.
 */
export function gpsOnlyCapture(): CaptureResult {
  return { uri: null, source: 'gps', capturedAt: Date.now() };
}

// ─── Image Analysis ───────────────────────────────────────────────────────────

export interface DetectedHazard {
  /** Hazard type inferred from visual cues */
  type: 'water' | 'bunker' | 'ob' | 'unknown';
  /** Normalized (0–1) position on the image */
  x: number;
  y: number;
  /** Detection confidence 0–1 */
  confidence: number;
}

export interface CameraImageAnalysis {
  /** Hazards detected in the image. Empty when none found or CV unavailable. */
  hazards: DetectedHazard[];
  /**
   * Depth map data URI or null.
   * Placeholder for future monocular depth estimation integration.
   */
  depthMap: string | null;
}

/**
 * Analyse a camera image URI for hazards and depth information.
 *
 * v1 implementation is a placeholder — returns empty hazards and no depth map.
 * Replace the body with a real CV/ML call when the model is available,
 * keeping the same signature so all callers remain unchanged.
 *
 * @param uri Local file URI returned by captureFromCamera / wrapScreenshot.
 */
export const processCameraImage = async (uri: string): Promise<CameraImageAnalysis> => {
  // TODO: integrate on-device CV model (e.g. TFLite / ONNX) to populate hazards
  // and a monocular depth estimation model for depthMap.
  return {
    hazards: [],
    depthMap: null,
  };
};
