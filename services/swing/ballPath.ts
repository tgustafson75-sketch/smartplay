/**
 * Ball-path tracker (client) — 2026-06-25 (Shot Tracing).
 *
 * The multi-frame sibling of ballDeparture.ts. Where ballDeparture samples ONE
 * after-frame to confirm the ball LEFT its spot (a strike guard + a single
 * launch-direction seed), this samples a SHORT SEQUENCE of frames across the
 * post-impact window and asks the vision endpoint to locate the ball in each.
 * The detected (non-null) positions are the MEASURED portion of a shot trace
 * (the solid line). Frames where the ball isn't visible come back null and are
 * simply dropped — never interpolated.
 *
 * Honest by construction (Tim's law): returns null on any missing input /
 * extraction failure / unconfigured server, and the server returns null per
 * frame it can't see. We surface only real detected positions; the dashed
 * "projected" continuation (if any) is computed separately and clearly marked
 * by the renderer — this module never fabricates a flight path.
 */

import * as VideoThumbnails from 'expo-video-thumbnails';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import { getApiBaseUrl } from '../apiBase';
import type { BallAreaNorm } from './ballDeparture';

const apiUrl = (): string => getApiBaseUrl();

/** Post-impact sampling window. The ball is still in (or just leaving) frame
 *  for a few hundred ms after a strike; sample across that span. Short-game /
 *  chip shots stay in view far longer, which the spacing still captures. */
const SAMPLE_START_MS = 30;   // first frame just after impact
const SAMPLE_END_MS = 700;    // last frame ~0.7s out
const SAMPLE_COUNT = 6;       // frames between start..end (<= server MAX_FRAMES)
/** Crop scale around the ball spot for the wide tracking frames — generous so a
 *  ball that has travelled stays inside the crop while it's still in frame. */
const WIDE_SCALE = 6;

export interface BallPathPoint {
  /** Full-frame normalized position of the detected ball (0..1). */
  x: number;
  y: number;
  /** ms after impact this frame was sampled at. */
  tMs: number;
}

export interface BallPathResult {
  /** The MEASURED ball positions, in time order. Only frames where the ball was
   *  actually seen. Length 0 when the ball was never trackable. */
  points: BallPathPoint[];
  /** How many frames we sampled (detected + missed). Lets the caller reason
   *  about coverage ("seen in 4 of 6"). */
  framesSampled: number;
  /** 2026-07-07 — SOURCE frame pixel dims. points[] are normalized against THESE, so
   *  the overlay needs the frame aspect to map them into the container's cover/contain
   *  space (services/swing/overlayCoords.ts). Null when nothing was sampled. */
  frameW?: number | null;
  frameH?: number | null;
}

interface Frame { uri: string; width: number; height: number }
interface CropBox { originX: number; originY: number; cw: number; ch: number; W: number; H: number }

async function frameAt(videoUri: string, timeMs: number): Promise<Frame | null> {
  try {
    const t = Math.max(0, Math.round(timeMs));
    const { uri, width, height } = await VideoThumbnails.getThumbnailAsync(videoUri, { time: t, quality: 0.9 });
    if (!uri || !width || !height) return null;
    return { uri, width, height };
  } catch {
    return null;
  }
}

async function cropWide(frame: Frame, ball: BallAreaNorm, scale: number): Promise<{ base64: string; box: CropBox } | null> {
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
    if (!manip.base64) return null;
    return { base64: manip.base64, box: { originX, originY, cw, ch, W, H } };
  } catch {
    return null;
  }
}

/** Map an in-crop position (0..1 of the crop) back to FULL-frame normalized. */
function cropToFullNorm(pos: { x: number; y: number }, box: CropBox): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(1, (box.originX + pos.x * box.cw) / box.W)),
    y: Math.max(0, Math.min(1, (box.originY + pos.y * box.ch) / box.H)),
  };
}

/**
 * Track the ball across the post-impact window. Returns the ordered MEASURED
 * positions (full-frame normalized) for the frames the ball was actually seen
 * in, or null when we can't run it honestly (no server / no impact time / no
 * ball spot / frame or network failure). An empty `points` array is a valid
 * honest result meaning "ran, but never saw the ball" — the caller degrades to
 * no-trace + an honest note.
 */
export async function detectBallPath(args: {
  videoUri: string;
  impactMs: number | null;
  ballArea: BallAreaNorm | null;
}): Promise<BallPathResult | null> {
  const base = apiUrl();
  if (!base) return null;
  if (args.impactMs == null || !args.ballArea) return null;

  // Sample evenly across the window.
  const offsets: number[] = [];
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const t = SAMPLE_START_MS + ((SAMPLE_END_MS - SAMPLE_START_MS) * i) / (SAMPLE_COUNT - 1);
    offsets.push(Math.round(t));
  }

  const frames = await Promise.all(offsets.map((o) => frameAt(args.videoUri, args.impactMs! + o)));
  const crops = await Promise.all(
    frames.map((f) => (f ? cropWide(f, args.ballArea!, WIDE_SCALE) : Promise.resolve(null))),
  );

  // Keep only the indices where we have a usable crop; track their box + tMs so
  // we can map detections back to full-frame coords in the right time order.
  const usable: { idx: number; base64: string; box: CropBox; tMs: number }[] = [];
  crops.forEach((c, i) => {
    if (c) usable.push({ idx: i, base64: c.base64, box: c.box, tMs: offsets[i] });
  });
  // Need at least 2 frames for a path; otherwise let the single-frame departure
  // detector (ballDeparture) own the read.
  if (usable.length < 2) {
    cleanup(frames);
    return null;
  }

  try {
    const res = await fetch(base + '/api/ball-path', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ frames: usable.map((u) => u.base64), media_type: 'image/jpeg' }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { positions?: ({ x: number; y: number } | null)[]; configured?: boolean };
    if (data.configured === false || !Array.isArray(data.positions)) return null;

    const points: BallPathPoint[] = [];
    data.positions.forEach((pos, i) => {
      const u = usable[i];
      if (!u || !pos || typeof pos.x !== 'number' || typeof pos.y !== 'number') return;
      const full = cropToFullNorm(pos, u.box);
      points.push({ x: full.x, y: full.y, tMs: u.tMs });
    });
    // Already in time order (usable was built in offset order). Drop exact
    // duplicate positions (the model occasionally repeats a static read).
    const deduped = points.filter((p, i) =>
      i === 0 || Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y) > 0.004);
    const frameW = usable[0]?.box.W ?? null;
    const frameH = usable[0]?.box.H ?? null;
    return { points: deduped, framesSampled: usable.length, frameW, frameH };
  } catch {
    return null;
  } finally {
    cleanup(frames);
  }
}

function cleanup(frames: (Frame | null)[]): void {
  for (const f of frames) {
    if (f?.uri) void FileSystem.deleteAsync(f.uri, { idempotent: true }).catch(() => undefined);
  }
}
