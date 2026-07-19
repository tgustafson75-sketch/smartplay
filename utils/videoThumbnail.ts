import * as VideoThumbnails from 'expo-video-thumbnails';

/**
 * 2026-07-18 (Tim — screen-recording mp4: app hard-crashes to the launcher during swing
 * analysis/playback) — GLOBAL single-flight queue around native video-thumbnail extraction.
 *
 * Android's MediaMetadataRetriever (behind expo-video-thumbnails) is not safe to run as several
 * concurrent instances against a file — especially one ExoPlayer is actively decoding for
 * playback. Doing so triggers a native OOM/SIGSEGV that kills the whole process to the home
 * screen (uncatchable from JS). Multiple analysis paths (poseDetection, clubPath, ballPath,
 * ballDeparture, feelReconcile, puttFrameExtractor, videoUpload) fan frame extraction out with
 * Promise.all, and two of them can overlap (e.g. clubhead detection while the clip plays).
 *
 * Routing EVERY getThumbnailAsync through this module (a drop-in re-export used in place of
 * `expo-video-thumbnails`) guarantees at most ONE retriever runs at a time app-wide, regardless
 * of how many callers fan out — the callers keep their existing Promise.all / retry / timeout
 * logic unchanged; only the concurrency is serialized. Slower, but it does not crash.
 */

// Pass through every other export (types, enums, other functions) untouched. The explicit
// getThumbnailAsync below shadows the star-exported one (local named exports take precedence).
export * from 'expo-video-thumbnails';

let chain: Promise<unknown> = Promise.resolve();

export function getThumbnailAsync(
  sourceFilename: string,
  options?: VideoThumbnails.VideoThumbnailsOptions,
): Promise<VideoThumbnails.VideoThumbnailsResult> {
  const run = chain.then(() => VideoThumbnails.getThumbnailAsync(sourceFilename, options));
  // Keep the chain alive whether this call resolves or rejects; never leak an unhandled rejection.
  chain = run.then(() => undefined, () => undefined);
  return run;
}
