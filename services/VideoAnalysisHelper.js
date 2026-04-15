/**
 * VideoAnalysisHelper.js
 *
 * Utilities for extracting analysis frames from a recorded swing video.
 *
 * Current implementation returns mock frame timestamps so that callers can
 * be built and tested before a real frame-extraction library is integrated
 * (e.g. expo-video-thumbnails, ffmpeg-kit-react-native, or a cloud function).
 *
 * Shape of a FrameEntry:
 *   { time: number }   — seconds from the start of the video
 *
 * Future extension points are marked with TODO comments.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

/** Default interval between sampled frames (seconds). */
const DEFAULT_INTERVAL = 0.5;

/** Maximum frames returned per call (guards against very long videos). */
const MAX_FRAMES = 20;

// ─── Types (JSDoc) ────────────────────────────────────────────────────────────

/**
 * @typedef {{ time: number }} FrameEntry
 */

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Extract key frames from a recorded video.
 *
 * @param {string}  videoUri               - Local file URI returned by expo-camera.
 * @param {object}  [options]
 * @param {number}  [options.interval=0.5] - Seconds between sampled frames.
 * @param {number}  [options.duration]     - Total video duration (seconds). When
 *                                           omitted, defaults to 1.5 s so the mock
 *                                           returns a sensible 3-frame result.
 * @returns {Promise<FrameEntry[]>}
 */
export async function extractFrames(videoUri, options = {}) {
  // ── Input validation ──────────────────────────────────────────────────────
  if (!videoUri || typeof videoUri !== 'string') {
    throw new Error('extractFrames: videoUri must be a non-empty string.');
  }

  const interval = options.interval ?? DEFAULT_INTERVAL;
  const duration = options.duration ?? 1.5;

  if (interval <= 0) {
    throw new Error('extractFrames: interval must be greater than 0.');
  }

  // ── TODO: Real implementation ─────────────────────────────────────────────
  // When a frame-extraction library is available, replace the mock below with
  // something like:
  //
  //   const { VideoThumbnails } = await import('expo-video-thumbnails');
  //   const frames = [];
  //   for (let t = interval; t <= duration && frames.length < MAX_FRAMES; t += interval) {
  //     const { uri } = await VideoThumbnails.getThumbnailAsync(videoUri, { time: t * 1000 });
  //     frames.push({ time: t, uri });
  //   }
  //   return frames;
  //
  // ── Mock implementation ───────────────────────────────────────────────────
  const frames = [];
  for (let t = interval; t <= duration && frames.length < MAX_FRAMES; t += interval) {
    // Round to 1 decimal place to keep values clean.
    frames.push({ time: Math.round(t * 10) / 10 });
  }

  return frames;
}

/**
 * Convenience wrapper: returns only the frame closest to the given timestamp.
 * Useful when a caller has a single `videoTime` (e.g. from ShotEntry.videoTime)
 * and wants the nearest sampled frame.
 *
 * @param {string}  videoUri
 * @param {number}  targetTime  - Seconds from video start.
 * @param {object}  [options]   - Forwarded to extractFrames.
 * @returns {Promise<FrameEntry | null>}
 */
export async function closestFrame(videoUri, targetTime, options = {}) {
  const frames = await extractFrames(videoUri, options);
  if (frames.length === 0) return null;

  return frames.reduce((best, f) =>
    Math.abs(f.time - targetTime) < Math.abs(best.time - targetTime) ? f : best
  );
}
