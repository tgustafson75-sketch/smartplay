import * as VideoThumbnails from 'expo-video-thumbnails';
import * as FileSystem from 'expo-file-system/legacy';

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
// getThumbnailAsync below shadows the star-exported one (local named exports take precedence —
// spec'd JS behavior; the import/export lint rule can't see that the shadowing is the point).
// eslint-disable-next-line import/export
export * from 'expo-video-thumbnails';

let chain: Promise<unknown> = Promise.resolve();

/**
 * 2026-08-09 (shared-copy verification) — serialize ANY native media reader through the SAME global
 * chain as the thumbnail retriever. Needed because probeDurationMs opens clips with expo-av
 * (Audio.Sound = a native decoder): under the shared-copy pool all consumers hold ONE file, so an
 * unserialized decoder could read it while a retriever does — the documented SIGSEGV class. At most
 * one native reader of any kind runs at a time app-wide.
 */
export function serializeMediaRead<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn);
  chain = run.then(() => undefined, () => undefined);
  return run;
}

/**
 * 2026-08-25 (Tim — "I've actually never waited for the analysis… everything needs to be as
 * streamlined as possible") — DECODE EACH FRAME ONCE.
 *
 * Seven analysis paths pull frames from the SAME clip — poseDetection's key frames, poseAnalysisApi's
 * pose frames, clubPath, ballPath, ballDeparture, feelReconcile, puttFrameExtractor — and several
 * ask for the same instant, because they are all anchored on the same impact. Every one of those was
 * a fresh native decode, and because the queue above serializes decodes app-wide to avoid the
 * MediaMetadataRetriever crash, each redundant decode is wall-clock the player waits through. On a
 * 4K phone clip a single retrieval is hundreds of milliseconds.
 *
 * TIMESTAMPS ARE BUCKETED to one frame at 30fps (33ms). Two requests 10ms apart on a 30fps video
 * resolve to the same physical frame, so decoding twice buys nothing.
 *
 * THE CACHE NEVER HANDS OUT ITS ORIGINAL. Callers DELETE the files they are given — ballDeparture
 * removes its before/after frames, clubPath removes its whole set — so a shared URI would be pulled
 * out from under the next consumer, or from under one still reading it. Every hit returns a fresh
 * COPY: a few milliseconds for a small JPEG against hundreds for a 4K decode, and the existing
 * ownership semantics are completely unchanged.
 *
 * A cached entry whose file has since vanished simply decodes again. Bounded by an LRU so a long
 * session cannot grow it without limit.
 */
const FRAME_BUCKET_MS = 33;
const CACHE_MAX = 96;
type CacheEntry = { uri: string; width: number; height: number };
const frameCache = new Map<string, CacheEntry>();

/**
 * 2026-08-25 — count what the cache actually saves, so the next slow analysis is evidence rather
 * than a guess. A decode avoided is wall-clock the player does not wait through, because the queue
 * above serializes every decode app-wide.
 */
let hits = 0;
let misses = 0;
export function thumbnailCacheStats(): { hits: number; misses: number; decodesSaved: number } {
  return { hits, misses, decodesSaved: hits };
}
export function _resetThumbnailCacheStats(): void { hits = 0; misses = 0; }

/** Same clip + same physical frame + same quality = the same decode. */
export function thumbnailCacheKey(
  sourceFilename: string,
  options?: VideoThumbnails.VideoThumbnailsOptions,
): string {
  const t = typeof options?.time === 'number' && Number.isFinite(options.time)
    ? Math.round(options.time / FRAME_BUCKET_MS)
    : 'auto';
  const q = typeof options?.quality === 'number' ? Math.round(options.quality * 100) : 'def';
  return `${sourceFilename}|${t}|${q}`;
}

/** Test seam + a hook for clearing between sessions. */
export function _clearThumbnailCache(): void {
  frameCache.clear();
  hits = 0;
  misses = 0;
}

async function copyOf(entry: CacheEntry): Promise<VideoThumbnails.VideoThumbnailsResult | null> {
  try {
    const info = await FileSystem.getInfoAsync(entry.uri);
    if (!info.exists) return null;                       // a consumer deleted it — decode again
    const dot = entry.uri.lastIndexOf('.');
    const ext = dot > 0 ? entry.uri.slice(dot) : '.jpg';
    const to = `${entry.uri.slice(0, dot > 0 ? dot : undefined)}_c${Math.round(performance.now() * 1000) % 1e9}${ext}`;
    await FileSystem.copyAsync({ from: entry.uri, to });
    return { uri: to, width: entry.width, height: entry.height };
  } catch {
    return null;                                         // never let the cache break a real read
  }
}

// eslint-disable-next-line import/export
export function getThumbnailAsync(
  sourceFilename: string,
  options?: VideoThumbnails.VideoThumbnailsOptions,
): Promise<VideoThumbnails.VideoThumbnailsResult> {
  const key = thumbnailCacheKey(sourceFilename, options);
  const run = chain.then(async () => {
    const hit = frameCache.get(key);
    if (hit) {
      const copy = await copyOf(hit);
      if (copy) {
        hits++;
        // LRU touch: re-inserting moves it to the newest position.
        frameCache.delete(key);
        frameCache.set(key, hit);
        return copy;
      }
      frameCache.delete(key);                            // stale entry, fall through to a real decode
    }
    misses++;
    const out = await VideoThumbnails.getThumbnailAsync(sourceFilename, options);
    try {
      frameCache.set(key, { uri: out.uri, width: out.width, height: out.height });
      while (frameCache.size > CACHE_MAX) {
        const oldest = frameCache.keys().next().value;
        if (oldest == null) break;
        frameCache.delete(oldest);
      }
      // Hand the CALLER a copy and keep the original, so their delete cannot empty the cache.
      const copy = await copyOf({ uri: out.uri, width: out.width, height: out.height });
      if (copy) return copy;
    } catch { /* caching is an optimisation; never fail a real read for it */ }
    return out;
  });
  // Keep the chain alive whether this call resolves or rejects; never leak an unhandled rejection.
  chain = run.then(() => undefined, () => undefined);
  return run;
}
