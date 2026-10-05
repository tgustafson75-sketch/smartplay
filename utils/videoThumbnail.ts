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
/**
 * 2026-08-25 (release hardening) — NO LINK IN THIS CHAIN MAY RUN FOREVER.
 *
 * The serialization above fixed a hard crash, but it made the chain a single shared resource with
 * no escape hatch: `chain.then(fn)` never settles if `fn` never settles, and from that moment EVERY
 * media read app-wide — this analysis and every one after it — waits behind a call that is never
 * coming back. Nothing recovers it short of killing the app. A wedged MediaMetadataRetriever on one
 * bad clip therefore took out frame extraction for the whole session.
 *
 * So each link is bounded. A single frame decode is normally well under a second; if one has not
 * answered in LINK_TIMEOUT_MS it is not slow, it is gone. We reject that caller — who already has
 * their own retry/fallback — and let the chain move on.
 *
 * THE TRADE-OFF, STATED HONESTLY: advancing the chain while a wedged native call may still be alive
 * reintroduces, for that one call, the concurrency this module exists to prevent. That is accepted
 * deliberately. The exposure is bounded to a decode already past every plausible healthy duration,
 * against the alternative of a permanently dead app. The timeout sits far above any healthy decode
 * precisely so it only ever fires on a genuine wedge, never on a slow-but-alive read.
 */
const LINK_TIMEOUT_MS = 20_000;

let wedged = 0;

/** How many chain links had to be abandoned. Surfaced in analysis telemetry; 0 in a healthy session. */
export function wedgedDecodeCount(): number { return wedged; }

function bounded<T>(fn: () => Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      wedged++;
      reject(new Error(`media_read_wedged: ${label} did not answer in ${LINK_TIMEOUT_MS}ms`));
    }, LINK_TIMEOUT_MS);
    fn().then(
      (v) => { if (!settled) { settled = true; clearTimeout(timer); resolve(v); } },
      (e) => { if (!settled) { settled = true; clearTimeout(timer); reject(e); } },
    );
  });
}

export function serializeMediaRead<T>(fn: () => Promise<T>): Promise<T> {
  // The chain waits on the BOUNDED link, so a wedge advances it instead of stopping it forever.
  const run = chain.then(() => bounded(fn, 'serializeMediaRead'));
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

let copySeq = 0;

async function copyOf(entry: CacheEntry): Promise<VideoThumbnails.VideoThumbnailsResult | null> {
  try {
    const info = await FileSystem.getInfoAsync(entry.uri);
    if (!info.exists) return null;                       // a consumer deleted it — decode again
    const dot = entry.uri.lastIndexOf('.');
    const ext = dot > 0 ? entry.uri.slice(dot) : '.jpg';
    // 2026-08-25 — a monotonic counter, not performance.now(). The clock version could collide for
    // two copies taken in the same microsecond, and if `performance` were ever unavailable it would
    // THROW into the catch below, silently disabling every cache copy app-wide with no signal at all.
    const to = `${entry.uri.slice(0, dot > 0 ? dot : undefined)}_c${++copySeq}${ext}`;
    await FileSystem.copyAsync({ from: entry.uri, to });
    return { uri: to, width: entry.width, height: entry.height };
  } catch {
    return null;                                         // never let the cache break a real read
  }
}

/**
 * 2026-10-03 — EXACT FRAMES ON ANDROID. The native retriever behind expo-video-thumbnails asks for
 * OPTION_CLOSEST_SYNC, i.e. the nearest keyframe (~1s apart in phone video), so every analysis that
 * sampled a swing got two or three distinct pictures. services/frameEngine seeks a browser <video>
 * to the exact time instead — the reason the web SmartMotion reads the same clip cleanly. Native
 * stays the fallback: engine not mounted, a non-file source, or the engine failing.
 *
 * Three consecutive engine failures switch it off for five minutes (was: the session), so a device where the WebView
 * cannot decode a clip pays the timeout three times, not once per frame.
 */
let engineFailures = 0;
/** 2026-10-04 (sweep) — three failures switch exact frames off for a while, not for the whole session. */
let engineOffUntil = 0;
const ENGINE_OFF_MS = 5 * 60_000;
function noteEngineFailure(why = 'unknown'): void {
  engineFailures++;
  (require('../services/analysisTrace') as typeof import('../services/analysisTrace')).traceStep('exact frame failed → native', { why, in_a_row: engineFailures });
  if (engineFailures >= 3) { engineOffUntil = Date.now() + ENGINE_OFF_MS; engineFailures = 0; }
}
let exactSeq = 0;
/**
 * 2026-10-03 (Tim: "this needs to happen in under 15 seconds") — the engine MEASURES ITSELF. Exact frames
 * are worth a little time, never a wait: if its grabs average over ENGINE_SLOW_MS on this device, the
 * rest of the session goes to the native retriever (keyframe-accurate, but fast). Re-tried after a few
 * minutes, since the first grabs of a session include the page warming up.
 */
// 2026-10-03 — measured: falling back at 700ms traded the read itself ("I couldn't see the top of your
// swing in these frames" — keyframe-snapped frames) for 3s, and then paid a 7.5s retry call. Native only
// takes over when the engine is effectively broken, never merely slower.
const ENGINE_SLOW_MS = 2_500;
let engineAvgMs = 0;
let engineSamples = 0;
let engineSlowUntil = 0;
function noteEngineMs(ms: number): void {
  engineSamples++;
  engineAvgMs = engineSamples === 1 ? ms : engineAvgMs * 0.6 + ms * 0.4;
  if (engineSamples >= 2 && engineAvgMs > ENGINE_SLOW_MS) {
    engineSlowUntil = Date.now() + 3 * 60_000;
    engineSamples = 0;
    console.log('[frames] browser engine slow on this device (' + Math.round(engineAvgMs) + 'ms/frame) — native for now');
    (require('../services/analysisTrace') as typeof import('../services/analysisTrace')).traceStep('exact frames too slow → native for 3 min', { ms_per_frame: Math.round(engineAvgMs) });
  }
}
async function exactOrNative(
  sourceFilename: string,
  options?: VideoThumbnails.VideoThumbnailsOptions,
): Promise<VideoThumbnails.VideoThumbnailsResult> {
  try {
    const { Platform } = require('react-native') as typeof import('react-native');
    const q = typeof options?.quality === 'number' ? options.quality : 1;
    /**
     * 2026-10-03 (Tim, same night: "it's taking FOREVER") — the engine is slower per frame than the
     * native retriever, so only the reads where EXACT timing changes the answer go through it: the
     * swing locator and pose sampling (quality 0.5-0.8). Duration probes (0.3 — they rely on a
     * past-the-end failure), club/ball path bursts (0.9 — many frames, ROI crops), and full-size
     * stills (1.0) stay on the fast native call.
     */
    const wantsExact = q >= 0.5 && q <= 0.8;
    if (
      Platform.OS === 'android' && wantsExact && Date.now() >= engineOffUntil && Date.now() >= engineSlowUntil
      && sourceFilename.startsWith('file://') && typeof options?.time === 'number'
    ) {
      const fe = require('../services/frameEngine') as typeof import('../services/frameEngine');
      if (await fe.ensureFrameEngine(6_000)) {
        // Pose and the locator need the body, not detail: 640px for the locator's quick looks
        // (quality 0.6), 960px for pose frames.
        const maxDim = q <= 0.6 ? 640 : 960;
        const t0 = Date.now();
        const g = await fe.grabExactFrame(sourceFilename, options.time, maxDim);
        noteEngineMs(Date.now() - t0);
        const uri = `${FileSystem.cacheDirectory}exact_${Date.now()}_${++exactSeq}.jpg`;
        await FileSystem.writeAsStringAsync(uri, g.b64, { encoding: FileSystem.EncodingType.Base64 });
        engineFailures = 0;
        return { uri, width: g.width, height: g.height };
      }
      // Never came up in 6s: that IS an engine failure (a page whose script died never posts 'ready',
      // and every frame would otherwise wait 6s inside the serialized media chain).
      noteEngineFailure('engine not ready in 6s');
    }
  } catch (e) {
    // "past end" is the CALLER's question (duration probing), and "queue timeout" is load, not a broken
    // engine — neither counts.
    const msg = e instanceof Error ? e.message : String(e);
    if (!/past end|queue timeout/.test(msg)) noteEngineFailure(msg);
  }
  return VideoThumbnails.getThumbnailAsync(sourceFilename, options);
}

// eslint-disable-next-line import/export
export function getThumbnailAsync(
  sourceFilename: string,
  options?: VideoThumbnails.VideoThumbnailsOptions,
): Promise<VideoThumbnails.VideoThumbnailsResult> {
  const key = thumbnailCacheKey(sourceFilename, options);
  const run = chain.then(() => bounded(async () => {
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
    const out = await exactOrNative(sourceFilename, options);
    try {
      frameCache.set(key, { uri: out.uri, width: out.width, height: out.height });
      while (frameCache.size > CACHE_MAX) {
        const oldest = frameCache.keys().next().value;
        if (oldest == null) break;
        const gone = frameCache.get(oldest);
        frameCache.delete(oldest);
        // Delete the evicted original too — the map entry was the only thing that knew it existed.
        if (gone) void FileSystem.deleteAsync(gone.uri, { idempotent: true }).catch(() => undefined);
      }
      // Hand the CALLER a copy and keep the original, so their delete cannot empty the cache.
      const copy = await copyOf({ uri: out.uri, width: out.width, height: out.height });
      if (copy) return copy;
    } catch { /* caching is an optimisation; never fail a real read for it */ }
    return out;
  }, 'getThumbnailAsync'));
  // Keep the chain alive whether this call resolves or rejects; never leak an unhandled rejection.
  chain = run.then(() => undefined, () => undefined);
  return run;
}

/**
 * 2026-10-04 (sweep) — files a previous launch left behind in the cache directory: exact-frame JPEGs
 * (exact_*, up to ~96 per session; the cache forgets them on restart but never deleted them) and
 * private clip copies (shared-clip-*, tens of MB each) from a session killed before the pool reaped
 * them. Both are only ever referenced in memory, so at launch nothing can still be using them.
 * Persistent thumbnails are copied into documentDirectory and are not touched.
 */
/** When this JS bundle started — files modified before it belong to an earlier launch. */
const MODULE_LOADED_AT = Date.now();

export async function sweepOrphanFrameFiles(bootAt: number = MODULE_LOADED_AT): Promise<number> {
  const dir = FileSystem.cacheDirectory;
  if (!dir) return 0;
  let n = 0;
  try {
    const names = await FileSystem.readDirectoryAsync(dir);
    for (const name of names) {
      if (!/^(exact_|shared-clip-)/.test(name)) continue;
      // Only what a PREVIOUS launch left: an analysis started in this launch's first seconds may already
      // be using a fresh copy or frame. Judged by the CREATION time both names carry
      // (shared-clip-<ms>-…, exact_<ms>_…), NOT the file's mtime — Android's copy keeps the SOURCE's
      // date, so a copy made a second ago of yesterday's clip looked a day old and was deleted mid-read
      // (Tim, 10-04: "tentative analysis, low confidence").
      const born = Number((name.match(/^(?:shared-clip-|exact_)(\d{12,})/) ?? [])[1]);
      if (!Number.isFinite(born) || born >= bootAt) continue;
      await FileSystem.deleteAsync(`${dir}${name}`, { idempotent: true }).catch(() => undefined);
      n++;
    }
  } catch { /* housekeeping only */ }
  return n;
}
