/**
 * SwingAnalysisEngine.js
 *
 * Analyses extracted video frames to produce swing characteristics.
 *
 * Current implementation uses mock/inference rules so that callers can be
 * built and tested before a real computer-vision pipeline is integrated
 * (e.g. TensorFlow.js pose estimation, a cloud ML endpoint, etc.).
 *
 * TODO markers indicate where real logic should be inserted later.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

/** @typedef {'in-to-out' | 'out-to-in' | 'neutral'} ClubPath */
/** @typedef {'open' | 'closed' | 'square'} FaceAngle */
/** @typedef {'fast' | 'smooth' | 'slow'} Tempo */

/**
 * @typedef {object} SwingAnalysis
 * @property {ClubPath}  clubPath  - Direction of club head travel through impact.
 * @property {FaceAngle} faceAngle - Relative face alignment at impact.
 * @property {Tempo}     tempo     - Perceived swing tempo.
 */

/**
 * @typedef {{ time: number, uri?: string }} FrameEntry
 */

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Stable seeded "random" based on frame data — same frames → same result. */
function seededChoice(arr, seed) {
  const idx = Math.abs(Math.round(seed)) % arr.length;
  return arr[idx];
}

/**
 * Infer face angle from a shot result string when available.
 * Encodes the basic ball-flight law:
 *   miss right  → face open relative to path
 *   miss left   → face closed relative to path
 *   straight    → square
 *
 * @param {string | undefined} shotResult
 * @returns {FaceAngle | null}  null when result is unknown
 */
function faceAngleFromShotResult(shotResult) {
  if (!shotResult) return null;
  const r = shotResult.toLowerCase();
  if (r === 'right') return 'open';
  if (r === 'left')  return 'closed';
  if (r === 'straight') return 'square';
  return null;
}

/**
 * Derive a simple tempo label from frame spacing.
 * Fewer frames per second → slower swing (camera captured more motion blur /
 * frames were sampled over a longer window).
 *
 * @param {FrameEntry[]} frames
 * @returns {Tempo}
 */
function tempoFromFrames(frames) {
  if (frames.length < 2) return 'smooth';

  // Average gap between consecutive frames (seconds).
  const gaps = frames.slice(1).map((f, i) => f.time - frames[i].time);
  const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;

  if (avgGap < 0.35) return 'fast';
  if (avgGap > 0.65) return 'slow';
  return 'smooth';
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Analyse a swing from a set of extracted video frames.
 *
 * @param {FrameEntry[]} frames       - Output of VideoAnalysisHelper.extractFrames().
 * @param {object}       [options]
 * @param {string}       [options.shotResult] - 'left' | 'straight' | 'right'.
 *                                             When supplied, face angle is inferred
 *                                             from ball-flight law instead of
 *                                             being randomised.
 * @returns {SwingAnalysis}
 */
export function analyzeSwing(frames, options = {}) {
  if (!Array.isArray(frames)) {
    throw new Error('analyzeSwing: frames must be an array.');
  }

  // ── Seed for deterministic mock values ─────────────────────────────────────
  // Sum of all timestamps gives a stable, frame-dependent seed.
  const seed = frames.reduce((acc, f) => acc + (f.time ?? 0), 0) * 100;

  // ── Club Path ───────────────────────────────────────────────────────────────
  // TODO: Replace with pose/landmark analysis (e.g. wrist plane at P6 → P7).
  /** @type {ClubPath[]} */
  const clubPaths = ['in-to-out', 'out-to-in', 'neutral'];
  const clubPath  = seededChoice(clubPaths, seed + 7);

  // ── Face Angle ──────────────────────────────────────────────────────────────
  // TODO: Replace with face-orientation estimation at impact frame.
  const inferredFace = faceAngleFromShotResult(options.shotResult);
  /** @type {FaceAngle[]} */
  const faceAngles = ['open', 'closed', 'square'];
  const faceAngle  = inferredFace ?? seededChoice(faceAngles, seed + 13);

  // ── Tempo ───────────────────────────────────────────────────────────────────
  // TODO: Replace with backswing-to-downswing ratio from keyframe timestamps.
  const tempo = tempoFromFrames(frames);

  return { clubPath, faceAngle, tempo };
}

/**
 * Returns a human-readable summary string for display in the UI.
 *
 * @param {SwingAnalysis} analysis
 * @returns {string}
 */
export function swingAnalysisSummary(analysis) {
  const { clubPath, faceAngle, tempo } = analysis;
  return `Path: ${clubPath} · Face: ${faceAngle} · Tempo: ${tempo}`;
}
