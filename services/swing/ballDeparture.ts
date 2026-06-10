/**
 * Ball-departure verifier (client) — 2026-06-09.
 *
 * Given the swing clip, the acoustic impact time, and the user-placed ball
 * spot, this samples the frame just before and just after impact, crops them
 * to the ball region, and asks the server vision endpoint whether the ball
 * actually LEFT its spot. Used to confirm an acoustic strike with what the
 * camera saw — the strongest guard against acoustic false positives (TV /
 * clap / neighbor's strike can't move YOUR ball).
 *
 * Honest by construction: returns null on any missing input / extraction
 * failure / unconfigured server. Never fabricates a verdict.
 */

import * as VideoThumbnails from 'expo-video-thumbnails';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';

const apiUrl = (): string => process.env.EXPO_PUBLIC_API_URL ?? '';

// How far before / after the acoustic impact to sample. A real strike has
// the ball still at rest a beat before and clearly gone a beat after.
const PRE_MS = 120;
const POST_MS = 160;

export interface BallDepartureResult {
  departed: boolean;
  ball_present_before: boolean;
  ball_present_after: boolean;
  direction: 'left' | 'right' | 'toward' | 'unknown';
  confidence: 'high' | 'medium' | 'low';
}

/** Normalized ball spot on the frame (0..1). r is a radius as a fraction of
 *  frame width. Matches cageStore.ball_area_norm. */
export interface BallAreaNorm { x: number; y: number; r?: number }

async function frameAt(videoUri: string, timeMs: number): Promise<{ uri: string; width: number; height: number } | null> {
  try {
    const t = Math.max(0, Math.round(timeMs));
    const { uri, width, height } = await VideoThumbnails.getThumbnailAsync(videoUri, { time: t, quality: 0.9 });
    if (!uri || !width || !height) return null;
    return { uri, width, height };
  } catch {
    return null;
  }
}

/** Crop a frame to a box centered on the normalized ball spot. `scale`
 *  multiplies the base ROI size (1 = tight ball box, 3 = wide context). */
async function cropRoi(
  frame: { uri: string; width: number; height: number },
  ball: BallAreaNorm,
  scale: number,
): Promise<string | null> {
  try {
    const { width: W, height: H } = frame;
    const r = ball.r && ball.r > 0 ? ball.r : 0.06;
    const half = Math.max(r * W, 0.05 * W) * scale;
    const cx = ball.x * W;
    const cy = ball.y * H;
    const originX = Math.max(0, Math.min(W - 1, Math.round(cx - half)));
    const originY = Math.max(0, Math.min(H - 1, Math.round(cy - half)));
    const cw = Math.max(8, Math.min(W - originX, Math.round(half * 2)));
    const ch = Math.max(8, Math.min(H - originY, Math.round(half * 2)));
    const manip = await ImageManipulator.manipulateAsync(
      frame.uri,
      [{ crop: { originX, originY, width: cw, height: ch } }],
      { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG, base64: true },
    );
    return manip.base64 ?? null;
  } catch {
    return null;
  }
}

/**
 * Verify a strike by checking the ball left its spot at impact. Returns null
 * when we can't run it honestly (no server, no impact time, no ball spot, or
 * a frame/crop/network failure).
 */
export async function detectBallDeparture(args: {
  videoUri: string;
  impactMs: number | null;
  ballArea: BallAreaNorm | null;
}): Promise<BallDepartureResult | null> {
  const base = apiUrl();
  if (!base) return null;
  if (args.impactMs == null || !args.ballArea) return null;

  const before = await frameAt(args.videoUri, args.impactMs - PRE_MS);
  const after = await frameAt(args.videoUri, args.impactMs + POST_MS);
  if (!before || !after) return null;

  const [beforeRoi, afterRoi, afterWide] = await Promise.all([
    cropRoi(before, args.ballArea, 1),
    cropRoi(after, args.ballArea, 1),
    cropRoi(after, args.ballArea, 3),
  ]);
  if (!beforeRoi || !afterRoi) return null;

  try {
    const res = await fetch(base + '/api/ball-departure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        before_roi: beforeRoi,
        after_roi: afterRoi,
        after_wide: afterWide ?? undefined,
        media_type: 'image/jpeg',
      }),
      // Bound the wait so a stalled server can't hang the swing flow; this is
      // a best-effort verifier and the catch below returns null gracefully.
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<BallDepartureResult> & { configured?: boolean };
    if (data.configured === false || typeof data.departed !== 'boolean') return null;
    return data as BallDepartureResult;
  } catch {
    return null;
  } finally {
    // Thumbnails land in the cache dir; clean up to avoid buildup.
    void FileSystem.deleteAsync(before.uri, { idempotent: true }).catch(() => undefined);
    void FileSystem.deleteAsync(after.uri, { idempotent: true }).catch(() => undefined);
  }
}
