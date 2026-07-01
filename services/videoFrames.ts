/**
 * 2026-06-30 (Tim — "video would be a really nice ingestion and analysis") — generic video
 * frame-extraction primitive for video INGESTION (course layout, scorecard, terrain, etc.),
 * distinct from the swing/putt extractors that sample SWING-phase fractions. This samples N
 * evenly-spaced frames across the whole clip and returns base64 JPEGs ready to hand to a vision
 * endpoint. Foundational: any "ingest a video → AI reads it" feature builds on this.
 *
 * Mirrors puttFrameExtractor's proven VT.getThumbnailAsync + ImageManipulator pipeline (resize
 * to 1024px, JPEG compress) so multi-frame payloads stay well under the vision request cap.
 * Fails SOFT — returns whatever frames succeeded (empty array on total failure); the caller
 * degrades to "no frames".
 */

import * as VT from 'expo-video-thumbnails';
import * as ImageManipulator from 'expo-image-manipulator';
import { Audio } from 'expo-av';
import { devLog } from './devLog';

export interface VideoFrame {
  /** Base64-encoded JPEG, no data: prefix. */
  b64: string;
  media_type: 'image/jpeg';
  /** Time within the clip (seconds) the frame was sampled at. */
  time_sec: number;
}

const FALLBACK_DURATION_MS = 6_000;

async function probeDurationMs(uri: string): Promise<number> {
  // Audio.Sound first (exact duration when the container carries it), then a VT lower-bound
  // probe. Mirrors puttFrameExtractor/poseDetection so behaviour is consistent app-wide.
  try {
    const { sound, status } = await Audio.Sound.createAsync({ uri }, { shouldPlay: false });
    if (status.isLoaded && status.durationMillis && status.durationMillis > 0) {
      const ms = status.durationMillis;
      await sound.unloadAsync().catch(() => {});
      return ms;
    }
    await sound.unloadAsync().catch(() => {});
  } catch (e) {
    devLog('[videoFrames] Audio.Sound duration probe failed (non-fatal): ' + String(e));
  }
  // VT lower-bound probe — higher ceilings than putts since ingestion clips (panning a
  // scorecard, a hole flyover) can run 10-30s+.
  for (const ms of [60_000, 30_000, 20_000, 10_000, 5_000, 3_000]) {
    try {
      await VT.getThumbnailAsync(uri, { time: ms, quality: 0.3 });
      return ms;
    } catch {
      /* frame past end → clip is shorter, try a smaller ceiling */
    }
  }
  return FALLBACK_DURATION_MS;
}

export interface ExtractVideoFramesOptions {
  /** How many evenly-spaced frames to sample (default 6, clamped 1..12). */
  count?: number;
  /** Long-edge resize target for each frame in px (default 1024). */
  width?: number;
  /** Skip this fraction of head+tail so we don't sample black lead-in/out (default 0.04). */
  edgePad?: number;
}

/**
 * Extract N evenly-spaced key frames from a video as base64 JPEGs. Reusable core for any
 * video-ingestion feature. Returns the frames that succeeded (may be fewer than `count`);
 * empty array if the video can't be read at all. Never throws.
 */
export async function extractVideoFrames(
  uri: string,
  opts: ExtractVideoFramesOptions = {},
): Promise<VideoFrame[]> {
  if (!uri) {
    devLog('[videoFrames] empty uri — no frames');
    return [];
  }
  const count = Math.max(1, Math.min(12, Math.round(opts.count ?? 6)));
  const width = opts.width ?? 1024;
  const edgePad = Math.max(0, Math.min(0.2, opts.edgePad ?? 0.04));
  try {
    const durationMs = await probeDurationMs(uri);
    const startMs = durationMs * edgePad;
    const spanMs = durationMs * (1 - 2 * edgePad);
    // Evenly space `count` samples across the usable span; for count===1 take the middle.
    const times = count === 1
      ? [startMs + spanMs / 2]
      : Array.from({ length: count }, (_, i) => startMs + (spanMs * i) / (count - 1));

    const frames = await Promise.all(
      times.map(async (timeMs) => {
        try {
          const r = await VT.getThumbnailAsync(uri, { time: Math.round(timeMs), quality: 0.8 });
          const m = await ImageManipulator.manipulateAsync(
            r.uri,
            [{ resize: { width } }],
            { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG, base64: true },
          );
          if (!m.base64) return null;
          return { b64: m.base64, media_type: 'image/jpeg' as const, time_sec: timeMs / 1000 };
        } catch (err) {
          devLog(`[videoFrames] frame @ ${Math.round(timeMs)}ms failed: ${err instanceof Error ? err.message : String(err)}`);
          return null;
        }
      }),
    );
    const valid = frames.filter((f): f is VideoFrame => f !== null);
    devLog(`[videoFrames] extracted ${valid.length}/${count} frames from ${Math.round(durationMs)}ms clip`);
    return valid;
  } catch (e) {
    devLog('[videoFrames] extractVideoFrames threw: ' + String(e));
    return [];
  }
}
