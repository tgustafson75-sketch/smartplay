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

/** Minimum detected points that must survive before we'll call it a real arc. */
const MIN_ARC_POINTS = 4;

/**
 * 2026-07-22 (Tim — "the club is consistently off; trace it correctly or not at all") — validate
 * the detections form a plausible clubhead SWEEP before returning them. A real swing arc spans a
 * meaningful fraction of the frame; a cluster is a mis-detection (the ball, the grip, or a
 * background object read as the head — the "off" club at address). If it doesn't look like a
 * sweep, the caller keeps the honest hand/tempo trace instead of drawing a wrong club.
 */
function looksLikeClubArc(pts: ClubPathPoint[]): boolean {
  if (pts.length < MIN_ARC_POINTS) return false;
  let minX = 1, maxX = 0, minY = 1, maxY = 0;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const spanX = maxX - minX, spanY = maxY - minY;
  // Forgiving (a partial arc is fine) but rejects a clustered blob: the sweep must cover a good
  // chunk of the frame in at least one axis, and not collapse to near a single point.
  if (Math.max(spanX, spanY) < 0.15) return false;
  if (spanX + spanY < 0.2) return false;
  return true;
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
  // 2026-07-21 (BETA — swing-replay crash) — abort check consulted BEFORE each native frame
  // extraction. The caller passes `() => isPlaying`, so the instant playback starts we stop
  // pulling frames: a MediaMetadataRetriever must never run concurrently with ExoPlayer decoding
  // the SAME file (native SIGSEGV to the launcher, uncatchable from JS = the "crash after replay").
  shouldAbort?: () => boolean;
}): Promise<ClubPathResult | null> {
  const base = apiUrl();
  if (!base) return null;
  const { videoUri, startMs, endMs, shouldAbort } = args;
  if (startMs == null || endMs == null || !(endMs > startMs)) return null;
  if (shouldAbort?.()) return null; // don't even start if already playing

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
    // 2026-07-21 — bail BETWEEN frames the moment playback (re)starts, so a retriever is never
    // decoding the file while ExoPlayer does. Clean up what we grabbed and abort — the arc is
    // best-effort (falls back to the wrist trace); a crash-to-launcher is not acceptable.
    if (shouldAbort?.()) { await cleanup(frames); return null; }
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
    // Only surface the detections as a club arc if they actually form a plausible sweep; a
    // clustered/degenerate set is a mis-detection → return empty so the renderer keeps the
    // honest hand/tempo trace rather than drawing a wrong "club" (Tim: trace it correctly).
    if (!looksLikeClubArc(deduped)) {
      return { points: [], framesSampled: usable.length, frameW, frameH };
    }
    return { points: deduped, framesSampled: usable.length, frameW, frameH };
  } catch {
    return null;
  } finally {
    await cleanup(frames);
  }
}
