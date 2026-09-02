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

/**
 * 2026-08-10 (Tim, from an on-course swing — "swing trace does not work, the club trace does not
 * work, it is not showing at all… you can see the club as easily as you can see the body… maybe we
 * need to put a Zoom where, if I put it back that far, which could happen on the course, how do we
 * then zoom in and take advantage?").
 *
 * He identified the fix himself, and his screenshot proves the diagnosis. In that frame the club is
 * unmistakable — a dark shaft and head against bright fairway — and the pose skeleton draws cleanly
 * on his body. But he fills roughly 15% of the frame height, because the phone was set well back
 * and low. We then DOWNSCALED the whole 1080p frame to 640px wide before asking the model to find
 * the clubhead. At that size he is ~100px tall and the clubhead is FIVE OR SIX PIXELS. Nothing can
 * find a 6px object; the gates below were never the binding constraint.
 *
 * It is the same resolution ceiling as the satellite tiles earlier today, and the same fix: stop
 * shrinking the whole picture, CROP to what matters and spend the pixels there. We already know
 * where the player is — the pose skeleton is reliable, which is exactly why the body overlay works
 * while the club trace doesn't. So crop to the player's bounds plus a generous margin for the arc
 * (the club sweeps far outside the body — well above the head at the top, and low and wide through
 * impact), then send THAT at full DOWNSCALE_W. The player goes from ~15% of the frame to most of
 * it, and the clubhead from ~6px to ~40px.
 *
 * Detections come back normalized to the CROP, so they're mapped back to full-frame coordinates
 * before anything downstream sees them. Everything after this point — the gates, the renderer —
 * keeps working in full-frame space, unchanged.
 */
export type Roi = { x: number; y: number; w: number; h: number };

/** Margin multipliers around the body box. Asymmetric because the arc is: the club goes far above
 *  the head at the top of the backswing and sweeps wide to both sides through impact and finish. */
const ROI_PAD_X = 1.1;   // ±110% of body width each side
const ROI_PAD_TOP = 0.9; // 90% of body height above the head
const ROI_PAD_BOTTOM = 0.35;

/** Body bounds (normalized) → the crop rect to send, clamped to the frame. Null when the box is
 *  already large (the player fills the frame — cropping would gain nothing and could clip the arc). */
export function roiFromBodyBounds(b: { minX: number; minY: number; maxX: number; maxY: number } | null): Roi | null {
  if (!b) return null;
  const bw = b.maxX - b.minX;
  const bh = b.maxY - b.minY;
  if (!(bw > 0) || !(bh > 0)) return null;
  // Already big in frame → the existing full-frame path is fine.
  if (bh >= 0.55) return null;
  const x = Math.max(0, b.minX - bw * ROI_PAD_X);
  const y = Math.max(0, b.minY - bh * ROI_PAD_TOP);
  const x2 = Math.min(1, b.maxX + bw * ROI_PAD_X);
  const y2 = Math.min(1, b.maxY + bh * ROI_PAD_BOTTOM);
  const w = x2 - x;
  const h = y2 - y;
  if (!(w > 0.05) || !(h > 0.05)) return null;
  return { x, y, w, h };
}

async function downscaled(frame: Frame, roi?: Roi | null): Promise<string | null> {
  try {
    const actions: ImageManipulator.Action[] = [];
    if (roi) {
      actions.push({
        crop: {
          originX: Math.round(roi.x * frame.width),
          originY: Math.round(roi.y * frame.height),
          width: Math.max(1, Math.round(roi.w * frame.width)),
          height: Math.max(1, Math.round(roi.h * frame.height)),
        },
      });
      // Always resize the CROP up/down to the send width — this is the "zoom": the same pixel
      // budget now covers the player instead of an acre of empty fairway.
      actions.push({ resize: { width: DOWNSCALE_W } });
    } else if (frame.width > DOWNSCALE_W) {
      actions.push({ resize: { width: DOWNSCALE_W } });
    }
    const manip = await ImageManipulator.manipulateAsync(
      frame.uri,
      actions,
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
/**
 * 2026-09-01 (Tim — "I've only seen it show up sporadically and mostly incorrect, where it doesn't
 * anchor on the ball box. It may get the direction right, but it looks like it's BEHIND the user")
 * — WHICH FRAMES INSIDE THE WINDOW GET SAMPLED.
 *
 * THE OLD SCHEDULE RAN OFF THE END OF THE SWING. It put 70% of the samples in the LAST 55% of the
 * window by fraction. The segmenter cuts 2,500ms before the strike and 1,500ms after, so that dense
 * half started around the transition and ran to the very last frame — and everything past roughly
 * 400ms after impact is FOLLOW-THROUGH, where the clubhead is back up over the player's shoulder.
 * Those points are real detections of a real clubhead. They are also exactly the ones that draw an
 * arc sitting behind the golfer instead of sweeping through the ball.
 *
 * Meanwhile the downswing itself — the ~250ms that actually shapes the arc through the ball — was
 * getting one or two frames out of fourteen. Sparse where it matters, dense where it misleads.
 *
 * WITH AN ANCHOR, sample around it: a few points to establish where the arc comes from, the bulk
 * through the downswing and the strike, and a short tail into the early follow-through so the arc has
 * somewhere to exit. WITHOUT ONE, nothing changes — the old fraction band is still the best guess
 * available, and inventing a centre is worse than spreading wide.
 * [[a-field-that-is-sometimes-a-placeholder]]
 *
 * Pure and exported so the schedule can be tested directly; detectClubPath does native + network work
 * that a unit test cannot reach, which is how this stayed unexamined for as long as it did.
 */
/** Late backswing + transition: gives the arc its top and its shape. */
const APPROACH_MS = 900;
/** Just past the ball — enough to show the exit, short of the finish. */
const TAIL_MS = 450;

export function clubPathSampleOffsets(startMs: number, endMs: number, impactMs: number | null): number[] {
  const offsets: number[] = [];
  const span = endMs - startMs;
  if (!(span > 0)) return offsets;

  const anchor =
    typeof impactMs === 'number' && Number.isFinite(impactMs) && impactMs > startMs && impactMs < endMs
      ? impactMs
      : null;

  if (anchor != null) {
    const leadIn = Math.max(startMs, anchor - APPROACH_MS);
    const tailEnd = Math.min(endMs, anchor + TAIL_MS);
    const nEarly = Math.max(2, Math.round(SAMPLE_COUNT * 0.2));  // where the arc comes from
    const nTail = Math.max(2, Math.round(SAMPLE_COUNT * 0.2));   // where it exits
    const nCore = Math.max(2, SAMPLE_COUNT - nEarly - nTail);    // the downswing through the ball
    const push = (from: number, to: number, n: number) => {
      if (!(to > from) || n <= 0) return;
      for (let i = 0; i < n; i++) offsets.push(Math.round(from + ((to - from) * i) / n));
    };
    push(startMs, leadIn, nEarly);
    push(leadIn, tailEnd, nCore);
    push(tailEnd, endMs, nTail);
    return offsets;
  }

  const BAND = 0.45; // address/backswing gets the first 45% of the timeline but only ~30% of the samples
  const early = Math.max(2, Math.round(SAMPLE_COUNT * 0.3));
  const late = SAMPLE_COUNT - early;
  for (let i = 0; i < early; i++) offsets.push(Math.round(startMs + span * ((i / early) * BAND)));
  for (let i = 0; i < late; i++) {
    offsets.push(Math.round(startMs + span * (BAND + ((1 - BAND) * i) / (late - 1))));
  }
  return offsets;
}

export async function detectClubPath(args: {
  videoUri: string;
  startMs: number | null;
  endMs: number | null;
  // 2026-07-21 (BETA — swing-replay crash) — abort check consulted BEFORE each native frame
  // extraction. The caller passes `() => isPlaying`, so the instant playback starts we stop
  // pulling frames: a MediaMetadataRetriever must never run concurrently with ExoPlayer decoding
  // the SAME file (native SIGSEGV to the launcher, uncatchable from JS = the "crash after replay").
  shouldAbort?: () => boolean;
  /**
   * 2026-08-10 — the player's body bounds in normalized full-frame coords, from the pose pass that
   * already ran. Supplying them turns on the ZOOM crop (see roiFromBodyBounds): we send a tight,
   * upscaled view of the player instead of a shrunken whole frame, so the clubhead is ~40px rather
   * than ~6px. Omit it and behavior is exactly as before.
   */
  bodyBounds?: { minX: number; minY: number; maxX: number; maxY: number } | null;
  /**
   * 2026-09-01 — the HONEST impact time inside [startMs, endMs], from
   * services/swing/clubPathWindow.impactAnchorMs (a heard strike, else the pose-labelled impact
   * frame). Omit it and sampling falls back to the fixed band below, exactly as before.
   *
   * Never pass a synthesized 0.6*duration placeholder here: impactAnchorMs refuses it on purpose,
   * and clustering the samples on an invented centre is worse than spreading them wide.
   * [[a-field-that-is-sometimes-a-placeholder]]
   */
  impactMs?: number | null;
}): Promise<ClubPathResult | null> {
  const base = apiUrl();
  if (!base) return null;
  const { videoUri, startMs, endMs, shouldAbort } = args;
  const roi = roiFromBodyBounds(args.bodyBounds ?? null);
  if (roi) console.log('[clubPath] ZOOM crop active —', JSON.stringify({ x: +roi.x.toFixed(3), y: +roi.y.toFixed(3), w: +roi.w.toFixed(3), h: +roi.h.toFixed(3) }));
  if (startMs == null || endMs == null || !(endMs > startMs)) return null;
  if (shouldAbort?.()) return null; // don't even start if already playing

  // 2026-07-25 (Tim's hypothesis — "offset passes to get the in-between frames near impact for better
  // analysis"). One adaptive-density pass rather than extra native retriever passes. The schedule and
  // the reasoning behind it now live in clubPathSampleOffsets above — 2026-09-01 moved it out of here
  // so it could be tested, and the band it used to compute inline is what put the arc behind the
  // player. The ceiling is still the source frame rate: past that, closer offsets return the same
  // decoded frame.
  const offsets = clubPathSampleOffsets(startMs, endMs, args.impactMs ?? null);

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
  if (!tempCopy) {
    // No arc for this swing — the skeleton renders alone and nothing said so.
    logCapabilityLost('clubpath_no_private_copy', { videoUri: videoUri.slice(-40) });
    return null;
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
    // best-effort (no trace drawn if we bail); a crash-to-launcher is not acceptable.
    if (shouldAbort?.()) { await cleanup(frames, null); sharedCopy?.release(); return null; }
    const f = await frameAt(workUri, o);
    frames.push(f);
    b64s.push(f ? await downscaled(f, roi) : null);
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
      // Detections are normalized to whatever we SENT. With the zoom crop active that's the crop,
      // so map back into full-frame space before anything downstream (gates, renderer) sees them —
      // they all reason in full-frame coordinates and must stay that way.
      const fx = roi ? roi.x + pos.x * roi.w : pos.x;
      const fy = roi ? roi.y + pos.y * roi.h : pos.y;
      points.push({ x: fx, y: fy, tMs: u.tMs });
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
