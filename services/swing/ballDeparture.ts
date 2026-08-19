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

import * as VideoThumbnails from '../../utils/videoThumbnail'; // serialized wrapper (native retriever crash fix)
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import { getApiBaseUrl } from '../apiBase';

const apiUrl = (): string => getApiBaseUrl();

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
  /** 2026-06-11 — the departed ball's position in FULL-frame normalized coords
   *  (0..1), mapped back from the wide after-frame crop. Feeds the DTL ball-trace
   *  direction (services/swing/ballTrace.ts). Null when the ball wasn't seen. */
  departurePoint?: { x: number; y: number } | null;
  /** 2026-07-07 — the SOURCE frame pixel dimensions (the thumbnail the detection ran
   *  on). departurePoint is normalized against THESE, so the overlay needs the frame
   *  aspect (frameW/frameH) to map it into the on-screen container's cover/contain space
   *  (services/swing/overlayCoords.ts). Null when the ball wasn't seen. */
  frameW?: number | null;
  frameH?: number | null;
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
interface CropBox { originX: number; originY: number; cw: number; ch: number; W: number; H: number }

async function cropRoi(
  frame: { uri: string; width: number; height: number },
  ball: BallAreaNorm,
  scale: number,
): Promise<{ base64: string; box: CropBox } | null> {
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
    if (manip.uri) void FileSystem.deleteAsync(manip.uri, { idempotent: true }).catch(() => undefined); // A7 — don't leak the crop temp
    if (!manip.base64) return null;
    return { base64: manip.base64, box: { originX, originY, cw, ch, W, H } };
  } catch {
    return null;
  }
}

/** Map a position WITHIN a crop (0..1 of the crop) back to FULL-frame normalized.
 *  Clamped to [0,1] — a ball marked at the extreme frame edge can otherwise push the
 *  mapped coord slightly past 1 via the min-crop-width floor (audit 2026-06-11). */
function cropToFullNorm(pos: { x: number; y: number }, box: CropBox): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(1, (box.originX + pos.x * box.cw) / box.W)),
    y: Math.max(0, Math.min(1, (box.originY + pos.y * box.ch) / box.H)),
  };
}

/**
 * Verify a strike by checking the ball left its spot at impact. Returns null
 * when we can't run it honestly (no server, no impact time, no ball spot, or
 * a frame/crop/network failure).
 */
/**
 * 2026-08-19 (Tim — "in analysis, I wanna see what fails silently so we can adjust… includes the shot
 * tracing and the body mechanics as well").
 *
 * When the private clip copy can't be made, this capability is GONE for the swing — and it used to go
 * without a word. That is how the clubhead trace could be missing for a WEEK before anyone noticed:
 * a console line on a tester's phone is invisible, so the issue log read as healthy while the feature
 * simply wasn't there. Refusing the copy is CORRECT (decoding the file ExoPlayer is playing is the
 * SIGSEGV vector); refusing it silently is not.
 */
function logCapabilityLost(stage: string, details: Record<string, unknown>): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../store/issueLogStore').useIssueLogStore.getState().addAppEvent(stage, details, 'analysis_error');
  } catch { /* best-effort — never throw from a failure path */ }
}

export async function detectBallDeparture(args: {
  videoUri: string;
  impactMs: number | null;
  ballArea: BallAreaNorm | null;
}): Promise<BallDepartureResult | null> {
  const base = apiUrl();
  if (!base) return null;
  if (args.impactMs == null || !args.ballArea) return null;

  // 2026-07-30 (analysis audit C3) — extract from a PRIVATE COPY so a native retriever never decodes the
  // clip ExoPlayer is looping (SIGSEGV). Copy-or-bail; source copy only needed through extraction.
  // 2026-08-09 (speed #3) — shared refcounted copy (services/swing/sharedClipCopy); copy-or-bail
  // refusal unchanged.
  let depWorkUri = args.videoUri;
  let sharedCopy: { uri: string; release: () => void } | null = null;
  try {
    const { acquireClipCopy } = await import('./sharedClipCopy');
    sharedCopy = await acquireClipCopy(args.videoUri);
  } catch { /* acquire failed — refusal below */ }
  if (!sharedCopy) {
    console.warn('[ballDeparture] private copy failed — skipping to avoid a native crash');
    // No strike cross-check for this swing: contact honesty silently downgrades to "couldn't see".
    logCapabilityLost('balldeparture_no_private_copy', { impactMs: args.impactMs ?? null });
    return null;
  }
  depWorkUri = sharedCopy.uri;
  let before: { uri: string; width: number; height: number } | null;
  let after: { uri: string; width: number; height: number } | null;
  try {
    before = await frameAt(depWorkUri, args.impactMs - PRE_MS);
    after = await frameAt(depWorkUri, args.impactMs + POST_MS);
  } finally {
    sharedCopy.release();
  }
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
        before_roi: beforeRoi.base64,
        after_roi: afterRoi.base64,
        after_wide: afterWide?.base64 ?? undefined,
        media_type: 'image/jpeg',
      }),
      // Bound the wait so a stalled server can't hang the swing flow; this is
      // a best-effort verifier and the catch below returns null gracefully.
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<BallDepartureResult> & {
      configured?: boolean;
      ball_after_norm?: { x: number; y: number } | null;
    };
    if (data.configured === false || typeof data.departed !== 'boolean') return null;
    // Map the ball's in-crop position (wide after-frame) → full-frame normalized.
    let departurePoint: { x: number; y: number } | null = null;
    if (data.ball_after_norm && afterWide) {
      departurePoint = cropToFullNorm(data.ball_after_norm, afterWide.box);
    }
    // Surface the source frame dims (from the wide after-crop's full W/H) so the overlay
    // can map departurePoint into the on-screen container's cover/contain space.
    const frameW = afterWide?.box.W ?? null;
    const frameH = afterWide?.box.H ?? null;
    return { ...(data as BallDepartureResult), departurePoint, frameW, frameH };
  } catch {
    return null;
  } finally {
    // Thumbnails land in the cache dir; clean up to avoid buildup.
    void FileSystem.deleteAsync(before.uri, { idempotent: true }).catch(() => undefined);
    void FileSystem.deleteAsync(after.uri, { idempotent: true }).catch(() => undefined);
  }
}

/**
 * 2026-08-19 (Tim — "we strengthen the ball detection and the ball detection area in the video, and we
 * make this smarter. How smart can we be without breaking anything?").
 *
 * Locate the ACTUAL ball in a setup still, so the ball box stops being a guess.
 *
 * Until now the box was placed under the golfer's detected FEET (smartmotion's framing loop) — a
 * proxy that is usually about right and silently wrong the rest of the time. It matters more than it
 * looks: the departure verifier CROPS to that box, and the shot trace STARTS from it, so a proxy at
 * the root travels all the way to "couldn't see the ball to confirm" on a swing that was struck
 * perfectly well.
 *
 * "Without breaking anything" is the whole design here:
 *   • the caller keeps its feet proxy until this RESOLVES — nothing waits on the network;
 *   • a null return (not configured / offline / no ball seen / low confidence) simply leaves the
 *     proxy in place, so the worst case is exactly today's behaviour;
 *   • the server refuses rather than guesses, and is told a refusal is expected.
 *
 * Returns FULL-frame normalized coords — the caller's box is in the same space, so it is a
 * drop-in replacement for the feet-derived centre.
 */
export async function locateBallInSetupFrame(base64Jpeg: string): Promise<{ x: number; y: number } | null> {
  if (!base64Jpeg) return null;
  try {
    const res = await fetch(apiUrl() + '/api/ball-departure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'locate', setup_frame: base64Jpeg, media_type: 'image/jpeg' }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { found?: boolean; ball_norm?: { x: number; y: number } | null; configured?: boolean };
    if (data.configured === false || data.found !== true || !data.ball_norm) return null;
    const { x, y } = data.ball_norm;
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return null;
    return { x, y };
  } catch {
    return null; // offline / blocked host — the feet proxy stands
  }
}
