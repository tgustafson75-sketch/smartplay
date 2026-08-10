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
// 2026-08-06 (Tim — "the blue club has NEVER once shown up; it needs to be THERE, slightly off is fine").
// The old 4-point + wide-span gates rejected most real swings (Sonnet returns null through the blurred
// downswing, so a valid partial arc often has only 3 confident points). Lowered so a genuine partial sweep
// draws instead of vanishing — still rejects a clustered blob (the "off club at address").
const MIN_ARC_POINTS = 3;

/**
 * 2026-07-22 (Tim — "the club is consistently off; trace it correctly or not at all") — validate
 * the detections form a plausible clubhead SWEEP before returning them. A real swing arc spans a
 * meaningful fraction of the frame; a cluster is a mis-detection (the ball, the grip, or a
 * background object read as the head — the "off" club at address). If it doesn't look like a
 * sweep, the caller draws NO trace instead of a wrong club (clubhead-or-nothing; the wrist fallback was removed).
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
  if (Math.max(spanX, spanY) < 0.10) return false;
  if (spanX + spanY < 0.13) return false;
  // 2026-08-06 (analysis audit) — span ALONE (a wide bounding box) is not enough: 3 UNRELATED confident
  // detections (address grip + the ball + a bright background object) span a wide box and used to pass,
  // drawing a blue shaft through garbage — exactly the "worse than nothing" Tim drew the line on. A real
  // clubhead SWEEP progresses; a scatter zig-zags/doubles back. Gate on path EFFICIENCY = straight-line
  // distance from first→last detection ÷ total point-to-point path length. A quarter-to-half-circle arc
  // scores ~0.57–0.64; the grip/ball/background scatter scores ~0.26. 0.45 keeps real (partial) arcs with
  // margin and rejects the scatter. Points are time-ordered, so this reads the actual swept progression.
  let pathLen = 0;
  for (let i = 1; i < pts.length; i++) {
    pathLen += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  if (pathLen <= 1e-6) return false;
  // 2026-08-08 (verification wave — "still don't see club trace" root #2) — whole-path efficiency
  // STRUCTURALLY rejects a COMPLETE swing: address→top→impact→finish doubles back on itself, so
  // netSpan/pathLen lands ~0.33 (< 0.45) and a perfect full-swing arc was thrown away as "scatter" —
  // deterministically, on every retry. The insight that survives: a real sweep is SMOOTH PER LEG while
  // scatter zig-zags at every scale. So: pass if the whole path is efficient (partial arcs, unchanged),
  // OTHERWISE split at the apex (farthest point from the start — the top of the swing) and require each
  // leg to be efficient, recursing one more level for legs that themselves double back (impact→finish).
  // Grip/ball/background scatter stays rejected: its legs zig-zag no matter how it's split.
  const eff = (a: number, b: number): boolean => {
    let len = 0;
    for (let i = a + 1; i <= b; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (len <= 1e-6) return false;
    return Math.hypot(pts[b].x - pts[a].x, pts[b].y - pts[a].y) / len >= 0.45;
  };
  const smooth = (a: number, b: number, depth: number): boolean => {
    if (eff(a, b)) return true;
    // 2026-08-10 (Tim — "no trace for a week") — was `< 5`, which on a SPARSE real arc (the clubhead is
    // only detected in ~6-8 frames, not all 14) left the doubled-back downswing leg too short to split,
    // rejecting valid full swings as scatter. Allow legs down to 3 points; the span gates above remain the
    // primary blob/scatter defense. (Final threshold calibration pending Tim's real-clip club-arc logs.)
    if (depth <= 0 || b - a < 2) return false; // need ≥3 points in a leg to claim a doubled-back real arc
    let apex = a + 1, best = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.hypot(pts[i].x - pts[a].x, pts[i].y - pts[a].y);
      if (d > best) { best = d; apex = i; }
    }
    if (apex <= a + 1 || apex >= b - 1) return false; // apex at an end = no real turnaround
    return smooth(a, apex, depth - 1) && smooth(apex, b, depth - 1);
  };
  if (!smooth(0, pts.length - 1, 2)) return false;
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
    // 2026-07-30 (audit A7) — delete the manipulator's temp output; we only use the base64, so the .uri
    // file (one per sampled frame, ~14/swing) would otherwise leak into the cache dir.
    if (manip.uri) void FileSystem.deleteAsync(manip.uri, { idempotent: true }).catch(() => undefined);
    return manip.base64 ?? null;
  } catch {
    return null;
  }
}

async function cleanup(frames: (Frame | null)[], tempCopy?: string | null): Promise<void> {
  await Promise.all([
    ...frames.map((f) => (f?.uri ? FileSystem.deleteAsync(f.uri, { idempotent: true }).catch(() => undefined) : Promise.resolve())),
    tempCopy ? FileSystem.deleteAsync(tempCopy, { idempotent: true }).catch(() => undefined) : Promise.resolve(),
  ]);
}

/**
 * Track the clubhead across the swing window [startMs, endMs]. Returns the ordered
 * MEASURED positions (full-frame normalized) for the frames the head was actually seen
 * in, or null when we can't run it honestly (no server / bad window / extraction or
 * network failure). An empty `points` array is a valid honest result meaning "ran, but
 * never clearly saw the head" — the caller draws NO trace (clubhead-or-nothing).
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

  // 2026-07-25 (Tim's hypothesis — "offset passes to get the in-between frames near impact for better
  // analysis"). Done as ONE adaptive-density pass (same benefit, no extra native retriever passes that
  // risk the SIGSEGV/battery cost): cluster the samples in the DOWNSWING→IMPACT→early-follow-through band
  // (~0.45–1.0 of the swing) where the clubhead moves fastest and the arc is most informative; sparse
  // through the slow address/backswing. A few early samples still anchor the arc's start. The ceiling is
  // the source frame rate — past that, closer offsets return the same decoded frame (device-tune later).
  const offsets: number[] = [];
  const span = endMs - startMs;
  const BAND = 0.45; // address/backswing gets the first 45% of the timeline but only ~30% of the samples
  const early = Math.max(2, Math.round(SAMPLE_COUNT * 0.3));
  const late = SAMPLE_COUNT - early;
  for (let i = 0; i < early; i++) {
    offsets.push(Math.round(startMs + span * ((i / early) * BAND)));
  }
  for (let i = 0; i < late; i++) {
    offsets.push(Math.round(startMs + span * (BAND + ((1 - BAND) * i) / (late - 1))));
  }

  // 2026-07-24 (Tim — WHITE-SCREEN crash in the swing library AFTER analysis, ROOT CAUSE) — the
  // frame-extraction retriever and ExoPlayer must never touch the SAME file. The isPlaying/
  // shouldAbort guards can't interrupt a native frame grab already in flight, so a replay tapped
  // mid-extraction still collided → native SIGSEGV. Because it's a NATIVE crash it bypasses the JS
  // ErrorBoundary entirely — the user sees a blank WHITE screen, not our dark error card (that's the
  // tell). Structural fix, independent of timing: extract from a PRIVATE COPY of the clip. The player
  // keeps the original; the retriever only ever opens the copy → different file handles → the crash
  // condition cannot occur. Best-effort — if the copy fails we fall back to the original (no worse
  // than before), and the shouldAbort guards stay as a second layer.
  // 2026-08-09 (speed #3) — the private copy now comes from the SHARED refcounted pool
  // (services/swing/sharedClipCopy): one copy per clip serves pose + tempo + club path + ball
  // departure instead of four full byte-copies per review. Refcounting makes sharing safe (the file
  // can't be deleted while ANY consumer holds it; the old per-invocation-unique names existed only
  // to stop one caller's delete-in-finally racing another — audit #25's class is solved structurally).
  let workUri = videoUri;
  let tempCopy: string | null = null;
  let sharedCopy: { uri: string; release: () => void } | null = null;
  try {
    const { acquireClipCopy } = await import('./sharedClipCopy');
    sharedCopy = await acquireClipCopy(videoUri);
    if (sharedCopy) { tempCopy = sharedCopy.uri; workUri = sharedCopy.uri; }
  } catch { /* acquire failed — refusal below */ }
  // 2026-07-27 (full-app audit) — if the private copy could NOT be made, do NOT fall back to decoding the
  // ORIGINAL. On a surface that keeps looping the same file (SmartMotion review), a native retriever on
  // the file ExoPlayer is playing is the exact SIGSEGV / white-screen vector. Return no arc instead —
  // skeleton-only is a fine degrade; a crash-to-launcher is not. (The old fallback assumed the caller had
  // paused playback, which is true for swing-detail but NOT for the always-looping review surface.)
  if (!tempCopy) return null;

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
    // best-effort (no trace drawn if we bail); a crash-to-launcher is not acceptable.
    if (shouldAbort?.()) { await cleanup(frames, null); sharedCopy?.release(); return null; }
    const f = await frameAt(workUri, o);
    frames.push(f);
    b64s.push(f ? await downscaled(f) : null);
  }

  const usable: { idx: number; base64: string; tMs: number }[] = [];
  b64s.forEach((b, i) => {
    if (b) usable.push({ idx: i, base64: b, tMs: offsets[i] - offsets[0] });
  });
  if (usable.length < 3) {
    await cleanup(frames, null);
    sharedCopy?.release();
    return null; // not enough frames to attempt an arc
  }

  const frameW = frames.find((f) => f)?.width ?? null;
  const frameH = frames.find((f) => f)?.height ?? null;

  try {
    const res = await fetch(base + '/api/club-path', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ frames: usable.map((u) => u.base64), media_type: 'image/jpeg' }),
      signal: AbortSignal.timeout(32_000), // background analysis; room for the stronger clubhead model
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
    // NO trace rather than a wrong "club" (Tim: trace it correctly or not at all).
    if (!looksLikeClubArc(deduped)) {
      return { points: [], framesSampled: usable.length, frameW, frameH };
    }
    return { points: deduped, framesSampled: usable.length, frameW, frameH };
  } catch {
    return null;
  } finally {
    await cleanup(frames, null); // frames only — the SHARED copy is released, never deleted here
    sharedCopy?.release();
  }
}
