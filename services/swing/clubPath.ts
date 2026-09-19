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
import { classifyArc } from './clubArcGate';
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
  /**
   * 2026-09-19 — how many offsets the SCHEDULE asked for, beside how many survived decoding.
   *
   * `framesSampled` alone cannot tell "the window was too short to hold more" from "the native
   * retriever failed on five of them", and those are different bugs with different fixes. The
   * 09-19 field report said `framesSampled: 14` and we had to read the sampler to know that was
   * also the number requested. [[the-app-log-knows-whats-wrong]]
   */
  framesPlanned: number;
  /** SOURCE frame pixel dims — points[] are normalized against these, so the overlay
   *  needs the aspect to map them into the container's cover/contain space. */
  frameW?: number | null;
  frameH?: number | null;
  /**
   * 2026-09-06 — WHY the arc came back empty, when it did.
   *
   * `points: []` was reported to the field as a bare "0 points", which reads as "the model saw
   * nothing" — but the same 0 is produced when the model saw plenty and a gate threw them away for
   * clustering or zig-zagging. Those have opposite fixes (fix the capture vs fix the detection), and
   * the log could not tell them apart. Null when the arc was accepted.
   *
   * `detected` is how many raw points existed BEFORE the gate, which is the number that was missing:
   * "rejected: scatter, detected: 8" is a completely different bug report from "rejected: none".
   */
  rejected?: { reason: 'none' | 'too_few' | 'cluster' | 'scatter'; detected: number; gate: 'server' | 'client' } | null;
}

/**
 * 2026-09-19 — THE GATE AND MIN_ARC_POINTS MOVED TO ./clubArcGate, which api/club-path.ts imports too.
 *
 * They were two identical copies of the same tuned function with ONE difference: this side deduped
 * near-identical detections before counting and the server did not. So a blurred downswing where the
 * model reports the same coordinates twice came out as "server counts 3 and accepts, client dedupes
 * to 2 and rejects", and the field log called it a client/server disagreement. See that file.
 */

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

/**
 * 2026-09-19 — THE DOWNSWING ITSELF: top-of-transition to the ball. Roughly 250-300ms for a real
 * swing, and the only stretch where the clubhead travels far enough between frames to give an arc
 * DISTINCT points rather than the same position reported again.
 */
const DOWNSWING_MS = 300;

/**
 * The source frame rate is the ceiling: two offsets closer than one frame decode the SAME image.
 * 30fps is the conservative floor — assuming faster would let us ask for frames that do not exist.
 * Callers that have MEASURED a rate pass it instead.
 */
const DEFAULT_SOURCE_FPS = 30;

export function clubPathSampleOffsets(
  startMs: number,
  endMs: number,
  impactMs: number | null,
  /**
   * 2026-09-01 — how wrong the anchor could be, from clubPathWindow.anchorToleranceMs. A thin
   * acoustic pickup still says roughly when the ball was struck, and roughly beats a fraction of the
   * clip; we simply spread the same frames over a window wide enough to absorb the error rather than
   * clustering tightly on a time we are not sure of.
   */
  toleranceMs = 0,
  /**
   * 2026-09-19 — the MEASURED source frame rate, when the capture engine resolved one. Two offsets
   * closer than a frame return the same image, so the schedule must not ask for them. Defaults to
   * the conservative 30fps floor: assuming faster would request frames that do not exist.
   */
  sourceFps: number | null = null,
): number[] {
  const fps = typeof sourceFps === 'number' && Number.isFinite(sourceFps) && sourceFps > 0
    ? sourceFps
    : DEFAULT_SOURCE_FPS;
  const minGapMs = 1000 / fps;
  const offsets: number[] = [];
  const span = endMs - startMs;
  if (!(span > 0)) return offsets;

  const anchor =
    typeof impactMs === 'number' && Number.isFinite(impactMs) && impactMs > startMs && impactMs < endMs
      ? impactMs
      : null;

  if (anchor != null) {
    const slop = Math.max(0, toleranceMs);
    const leadIn = Math.max(startMs, anchor - APPROACH_MS - slop);
    const tailEnd = Math.min(endMs, anchor + TAIL_MS + slop);

    /**
     * 2026-09-02 (adversarial pass over the previous day's own work) — SPEND THE WHOLE FRAME BUDGET.
     *
     * The first version allocated a fixed count to each of the three ranges and skipped any range
     * that had collapsed to nothing. So when the anchor sat near the start or end of the window — or
     * when a LOW-CONFIDENCE strike widened the core past an edge — a whole group was dropped and the
     * sampler quietly returned 11 or 8 frames instead of 14.
     *
     * That is exactly backwards. Those are the reads that are already hardest: an anchor at the edge
     * is an uncertain one, and a wide tolerance means a thin acoustic pickup. Handing them FEWER
     * frames than a clean, centred strike gets is the opposite of degrading gracefully — and it is
     * invisible, because a sparser arc looks like a harder swing to track rather than like a bug.
     * [[overstrict-gate-lens]]
     *
     * The budget is now distributed across whichever ranges actually exist, by weight, always summing
     * to SAMPLE_COUNT. A collapsed range gives its share to its neighbours instead of to nobody.
     */
    /**
     * 2026-09-19 — SPLIT THE CORE, BECAUSE SPREADING IT EVENLY SPENT THE BUDGET WHERE THE CLUB IS
     * NEARLY STILL.
     *
     * The 09-01 note above says the bug it fixed was "the downswing itself — the ~250ms that
     * actually shapes the arc through the ball — was getting one or two frames out of fourteen."
     * It narrowed the WINDOW, correctly, and then spread the samples UNIFORMLY across a 1,350ms
     * core. Measured on the real function: on the nominal 4,000ms segment the downswing still got
     * TWO of fourteen, and the strike frame itself was never sampled at all. The fix did not reach
     * its own stated goal, and nothing measured it — the test asserted only that the anchored
     * schedule beat the unanchored one, which is a comparison against something worse.
     *
     * WHY IT MATTERS MORE THAN IT LOOKS. An arc needs DISTINCT points. Around the top of the swing
     * the clubhead is nearly stationary, so consecutive samples 110-170ms apart come back at
     * almost the same coordinates — and the gate dedupes near-identical detections before counting
     * them. Budget spent there does not just add less; it can add NOTHING, because the points
     * collapse into one. That is the most likely reading of the 09-19 field report: fourteen
     * frames, two surviving points, `too_few`.
     *
     * So the core splits. The stretch where the club MOVES gets the density, the top keeps enough
     * to give the arc an origin, and the exit keeps enough to show it leaving the ball.
     */
    const downswingStart = Math.max(leadIn, anchor - DOWNSWING_MS - slop);
    const ranges = [
      /**
       * The first weight is 0.15 and not lower on purpose: `club-path-sampling` requires at least
       * two samples before the approach band, because "the arc needs somewhere to come from" — and
       * at 0.10 the budget rounded to ONE, leaving a 1,600ms hole at the head of the swing. Caught
       * by that test, which is exactly what it is for.
       */
      { from: startMs, to: leadIn, weight: 0.15 },              // address + early backswing: the origin
      { from: leadIn, to: downswingStart, weight: 0.20 },       // late backswing + transition
      { from: downswingStart, to: anchor, weight: 0.40 },       // THE DOWNSWING — where the arc is shaped
      { from: anchor, to: tailEnd, weight: 0.25 },              // the strike and the exit
    ].filter((r) => r.to > r.from);
    if (ranges.length === 0) return offsets;

    const totalWeight = ranges.reduce((n, r) => n + r.weight, 0);
    // Largest-remainder allocation so the counts sum to EXACTLY the budget, never 13 or 15.
    const raw = ranges.map((r) => (SAMPLE_COUNT * r.weight) / totalWeight);
    const counts = raw.map((x) => Math.floor(x));
    let left = SAMPLE_COUNT - counts.reduce((n, x) => n + x, 0);
    const order = raw.map((x, i) => ({ i, frac: x - Math.floor(x) })).sort((a, b) => b.frac - a.frac);
    for (let k = 0; left > 0; k++, left--) counts[order[k % order.length]!.i]! += 1;

    /**
     * 2026-09-19 — AND THE SAME REDISTRIBUTION AGAINST THE PHYSICAL CEILING.
     *
     * The 09-02 note above fixed a budget that went unspent when a RANGE COLLAPSED. There is a
     * second way to under-spend it, which that pass could not have seen because nothing enforced
     * the frame ceiling: a range that exists but is too SHORT to hold the samples it was given.
     * Nine offsets across 120ms is four distinct frames at 30fps and five re-decodes of frames we
     * already have — and once the arc gate dedupes, those five cost budget and return nothing.
     *
     * Measured before this: an anchor 120ms into the window returned EIGHT usable offsets out of a
     * budget of fourteen. That is the same "hands the hardest reads fewer frames" failure the
     * 09-02 note called exactly backwards, arriving through physics rather than through arithmetic.
     *
     * So each range is capped at what it can actually hold, and the surplus goes to ranges with
     * room left. [[overstrict-gate-lens]]
     */
    const capacity = ranges.map((r) => Math.max(1, Math.floor((r.to - r.from) / minGapMs)));
    for (let pass = 0; pass < ranges.length; pass++) {
      let surplus = 0;
      for (let i = 0; i < counts.length; i++) {
        if (counts[i]! > capacity[i]!) { surplus += counts[i]! - capacity[i]!; counts[i] = capacity[i]!; }
      }
      if (surplus === 0) break;
      // Hand it to whoever still has room, widest range first — that is where extra frames are
      // furthest apart and so most likely to be distinct positions rather than the same one twice.
      const room = counts
        .map((c, i) => ({ i, spare: capacity[i]! - c, span: ranges[i]!.to - ranges[i]!.from }))
        .filter((x) => x.spare > 0)
        .sort((a, b) => b.span - a.span);
      if (room.length === 0) break;
      for (let k = 0; surplus > 0 && k < room.length * 4; k++) {
        const slot = room[k % room.length]!;
        if (counts[slot.i]! < capacity[slot.i]!) { counts[slot.i]! += 1; surplus -= 1; }
      }
      if (surplus > 0) break; // genuinely nowhere left to put them — the window is simply short
    }

    ranges.forEach((r, i) => {
      const n = counts[i]!;
      for (let j = 0; j < n; j++) offsets.push(Math.round(r.from + ((r.to - r.from) * j) / n));
    });
    /**
     * THE STRIKE FRAME, ALWAYS. Each range samples `from` and steps forward, so the END of a range
     * is never taken — which meant the anchor itself was sampled only by coincidence, and measured
     * on the nominal segment it never was. It is the one frame whose position says where the arc
     * passes the ball; leaving it to chance is not a schedule.
     */
    const anchorMs = Math.round(anchor);
    offsets.push(anchorMs);
    return tidy(offsets, minGapMs, anchorMs);
  }

  const BAND = 0.45; // address/backswing gets the first 45% of the timeline but only ~30% of the samples
  const early = Math.max(2, Math.round(SAMPLE_COUNT * 0.3));
  const late = SAMPLE_COUNT - early;
  for (let i = 0; i < early; i++) offsets.push(Math.round(startMs + span * ((i / early) * BAND)));
  for (let i = 0; i < late; i++) {
    offsets.push(Math.round(startMs + span * (BAND + ((1 - BAND) * i) / (late - 1))));
  }
  return tidy(offsets, minGapMs);
}

/**
 * 2026-09-19 — ORDER THE OFFSETS AND DROP THE ONES THAT WOULD DECODE THE SAME FRAME TWICE.
 *
 * The header above has always named this ceiling — "past that, closer offsets return the same
 * decoded frame" — and nothing enforced it. On a SHORT segment it bites: measured on the real
 * function, a 400ms window asks for 14 offsets that resolve to 12 distinct frames at 30fps, and a
 * 300ms window to 10. Each collision costs a native decode, a downscale and a vision-model frame,
 * and returns an image we already have — so the model reports the same coordinates again and the
 * gate's dedupe collapses them. Budget spent to REDUCE the point count.
 *
 * Sorting matters too: the ranges are emitted in order but the strike is appended last, and the
 * arc's efficiency test reads the points as a time-ordered progression.
 */
function tidy(offsets: number[], minGapMs: number, keepMs: number | null = null): number[] {
  /**
   * Compared by FRAME INDEX, not by elapsed milliseconds. `t - last >= minGapMs` looks equivalent
   * and is not: a schedule stepping at exactly the frame interval rounds to 33, 34, 33, 34… and a
   * millisecond test throws away every 33 while keeping every 34, which drops frames that really
   * are distinct. Two offsets are the same frame if and only if they land in the same interval.
   */
  const frameOf = (t: number) => Math.floor(t / minGapMs);
  const sorted = [...offsets].sort((a, b) => a - b);
  const out: number[] = [];
  for (const t of sorted) {
    const last = out[out.length - 1];
    if (last == null || frameOf(t) !== frameOf(last)) { out.push(t); continue; }
    /**
     * A collision with the STRIKE is resolved in the strike's favour. Both offsets decode the same
     * frame, so keeping either costs the same — but the one we keep is the one whose timestamp is
     * carried downstream as the point's `tMs`, and an arc whose defining point is stamped 28ms
     * before the ball is an arc that says something slightly untrue about when the club was there.
     */
    if (keepMs != null && t === keepMs) out[out.length - 1] = t;
  }
  return out;
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
  /** How wrong `impactMs` could be — see clubPathWindow.anchorToleranceMs. Widens the dense band. */
  toleranceMs?: number | null;
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
  const offsets = clubPathSampleOffsets(startMs, endMs, args.impactMs ?? null, args.toleranceMs ?? 0);

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
    const data = (await res.json()) as {
      positions?: ({ x: number; y: number } | null)[];
      configured?: boolean;
      rejected?: { reason: 'none' | 'too_few' | 'cluster' | 'scatter'; detected: number } | null;
    };
    if (data.configured === false || !Array.isArray(data.positions)) return null;
    // The server already classified its own rejection; carry it rather than re-deriving it from
    // all-nulls, which is the information loss this whole change is about.
    if (data.rejected) {
      return {
        points: [], framesSampled: usable.length, framesPlanned: offsets.length, frameW, frameH,
        rejected: { ...data.rejected, gate: 'server' },
      };
    }

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
    /**
     * Time-ordered already. The SHARED gate dedupes and classifies — the same call on the same set
     * the server makes, so the two can no longer reach different answers about one swing.
     *
     * A clustered or degenerate set is a mis-detection, and the renderer keeps NO trace rather than
     * drawing a wrong "club" (Tim: trace it correctly or not at all).
     */
    const { rejection, points: deduped } = classifyArc(points);
    if (rejection) {
      /**
       * 2026-09-19 — this now means what its old comment CLAIMED: the server accepted a set this
       * side refused, which after the shared gate is a real disagreement and worth chasing. Before
       * today it fired on nothing more than one duplicate detection.
       */
      return {
        points: [], framesSampled: usable.length, framesPlanned: offsets.length, frameW, frameH,
        rejected: { reason: rejection, detected: deduped.length, gate: 'client' },
      };
    }
    return { points: deduped as ClubPathPoint[], framesSampled: usable.length, framesPlanned: offsets.length, frameW, frameH, rejected: null };
  } catch {
    return null;
  } finally {
    await cleanup(frames, null); // frames only — the SHARED copy is released, never deleted here
    sharedCopy?.release();
  }
}
