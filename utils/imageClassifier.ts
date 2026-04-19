/**
 * utils/imageClassifier.ts
 *
 * Classifies an input (image URI or GPS-only) into a golf scene type.
 * Heuristic-based — no ML model required for v1.
 *
 * Pipeline position:
 *   Input (camera | screenshot | gps) → THIS → VisionRouter
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type InputSource = 'camera' | 'screenshot' | 'gps';

export type SceneType =
  | 'scorecard'
  | 'hole_overview'
  | 'fairway'
  | 'green'
  | 'gps_only'
  | 'unknown';

export interface ImageClassification {
  /** Detected scene type */
  type: SceneType;
  /** 0–1 confidence for this classification */
  confidence: number;
  /** Originating input source */
  source: InputSource;
}

// ─── Heuristics ───────────────────────────────────────────────────────────────

/**
 * URI-based heuristics for the scene type.
 * When a real CV model is available, swap this implementation
 * while keeping the same signature.
 */
function detectSceneFromUri(uri: string): { type: SceneType; confidence: number } {
  const lower = uri.toLowerCase();

  if (lower.includes('scorecard') || lower.includes('score')) {
    return { type: 'scorecard', confidence: 0.85 };
  }
  if (lower.includes('overview') || lower.includes('aerial') || lower.includes('hole')) {
    return { type: 'hole_overview', confidence: 0.80 };
  }
  if (lower.includes('green') || lower.includes('flag') || lower.includes('pin')) {
    return { type: 'green', confidence: 0.80 };
  }
  if (lower.includes('fairway') || lower.includes('tee') || lower.includes('drive')) {
    return { type: 'fairway', confidence: 0.75 };
  }

  // No heuristic match — default to fairway with low confidence so the engine
  // still produces a useful recommendation.
  return { type: 'fairway', confidence: 0.40 };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Classify an image URI or GPS-only input into a scene type.
 *
 * @param uri    Image URI from camera/screenshot capture, or null for GPS-only mode.
 * @param source The originating input mechanism.
 */
export function classifyImage(uri: string | null, source: InputSource): ImageClassification {
  if (source === 'gps' || uri === null) {
    return { type: 'gps_only', confidence: 1.0, source };
  }

  const { type, confidence } = detectSceneFromUri(uri);
  return { type, confidence, source };
}
