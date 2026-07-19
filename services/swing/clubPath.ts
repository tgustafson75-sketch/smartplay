/**
 * Clubhead-path tracker (client) — 2026-07-07 (Tim — real clubhead swing arc).
 *
 * The swing-wide sibling of ballPath.ts. Samples frames ACROSS the swing (address →
 * top → downswing → impact → follow-through) and asks /api/club-path to locate the
 * CLUBHEAD in each. The detected (non-null) positions are the MEASURED clubhead arc.
 * Unlike the ball, the clubhead sweeps the whole frame, so we send DOWNSCALED FULL
 * frames (no crop) and the model returns full-frame normalized positions directly.
 *
 * Honest by construction (Tim's law): returns null on any missing input / extraction
 * failure / unconfigured server; the server returns null per frame it can't clearly
 * see the head in (heavy motion-blur through impact is expected). We surface ONLY real
 * detected positions — the renderer draws through them and gaps the rest, clearly as a
 * partial/estimated read. Never a fabricated smooth club path.
 */

import * as VideoThumbnails from '../../utils/videoThumbnail'; // serialized wrapper (native retriever crash fix)
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import { getApiBaseUrl } from '../apiBase';

const apiUrl = (): string => getApiBaseUrl();

/** How many frames to sample across the swing window (<= server MAX_FRAMES). More
 *  than the ball path: the clubhead arc is a longer, richer curve. 2026-07-18 — 12 → 14 for a
 *  denser, smoother arc (the extra points land in the clearer backswing/follow-through). */
const SAMPLE_COUNT = 14;
/** Downscale long-edge for the full-frame sends — small enough for cost/latency,
 *  large enough that the model can still pick out the head. */
const DOWNSCALE_W = 640;

export interface ClubPathPoint {
  /** Full-frame normalized clubhead position (0..1). */
  x: number;
  y: number;
  /** ms from the swing-window start this frame was sampled at. */
  tMs: number;
}

export interface ClubPathResult {
  /** MEASURED clubhead positions, in time order. Only frames where the head was
   *  actually seen. Length 0 when the head was never trackable. */
  points: ClubPathPoint[];
  /** Frames sampled (detected + missed) → coverage ("seen in 7 of 12"). */
  framesSampled: number;
  /** SOURCE frame pixel dims — points[] are normalized against these, so the overlay
   *  needs the aspect to map them into the container's cover/contain space. */
  frameW?: number | null;
  frameH?: number | null;
}

interface Frame { uri: string; width: number; height: number }

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

async function downscaled(frame: Frame): Promise<string | null> {
  try {
    const manip = await ImageManipulator.manipulateAsync(
      frame.uri,
      frame.width > DOWNSCALE_W ? [{ resize: { width: DOWNSCALE_W } }] : [],
      { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true },
    );
    return manip.base64 ?? null;
  } catch {
    return null;
  }
}

async function cleanup(frames: (Frame | null)[]): Promise<void> {
  await Promise.all(
    frames.map((f) => (f?.uri ? FileSystem.deleteAsync(f.uri, { idempotent: true }).catch(() => undefined) : Promise.resolve())),
  );
}

/**
 * Track the clubhead across the swing window [startMs, endMs]. Returns the ordered
 * MEASURED positions (full-frame normalized) for the frames the head was actually seen
 * in, or null when we can't run it honestly (no server / bad window / extraction or
 * network failure). An empty `points` array is a valid honest result meaning "ran, but
 * never clearly saw the head" — the caller keeps the honest hand/tempo trace.
 */
export async function detectClubPath(args: {
  videoUri: string;
  startMs: number | null;
  endMs: number | null;
}): Promise<ClubPathResult | null> {
  const base = apiUrl();
  if (!base) return null;
  const { videoUri, startMs, endMs } = args;
  if (startMs == null || endMs == null || !(endMs > startMs)) return null;

  // Sample evenly across the swing window.
  const offsets: number[] = [];
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    offsets.push(Math.round(startMs + ((endMs - startMs) * i) / (SAMPLE_COUNT - 1)));
  }

  // 2026-07-18 (Tim — crash mp4: hard crash to home during swing playback) — extract frames
  // SEQUENTIALLY, not with Promise.all. Firing SAMPLE_COUNT (12) concurrent
  // VideoThumbnails.getThumbnailAsync calls spins up 12 native Android MediaMetadataRetriever
  // instances against the SAME file ExoPlayer is actively decoding for playback — a known
  // native OOM/SIGSEGV vector that crashes the whole app to the launcher (uncatchable from JS).
  // One retriever at a time is slow-but-safe; this is a background analysis, not a latency path.
  const frames: (Frame | null)[] = [];
  const b64s: (string | null)[] = [];
  for (const o of offsets) {
    const f = await frameAt(videoUri, o);
    frames.push(f);
    b64s.push(f ? await downscaled(f) : null);
  }

  const usable: { idx: number; base64: string; tMs: number }[] = [];
  b64s.forEach((b, i) => {
    if (b) usable.push({ idx: i, base64: b, tMs: offsets[i] - offsets[0] });
  });
  if (usable.length < 4) {
    await cleanup(frames);
    return null; // not enough frames to attempt an arc
  }

  const frameW = frames.find((f) => f)?.width ?? null;
  const frameH = frames.find((f) => f)?.height ?? null;

  try {
    const res = await fetch(base + '/api/club-path', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ frames: usable.map((u) => u.base64), media_type: 'image/jpeg' }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { positions?: ({ x: number; y: number } | null)[]; configured?: boolean };
    if (data.configured === false || !Array.isArray(data.positions)) return null;

    const points: ClubPathPoint[] = [];
    data.positions.forEach((pos, i) => {
      const u = usable[i];
      if (!u || !pos || typeof pos.x !== 'number' || typeof pos.y !== 'number') return;
      if (!(pos.x >= 0 && pos.x <= 1 && pos.y >= 0 && pos.y <= 1)) return;
      points.push({ x: pos.x, y: pos.y, tMs: u.tMs });
    });
    // Already in time order. Drop exact-duplicate positions (a static repeat read).
    const deduped = points.filter((p, i) =>
      i === 0 || Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y) > 0.004);
    return { points: deduped, framesSampled: usable.length, frameW, frameH };
  } catch {
    return null;
  } finally {
    await cleanup(frames);
  }
}
