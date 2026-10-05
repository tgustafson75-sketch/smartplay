/**
 * 2026-09-01 — FIND THE SWING ON THE DEVICE, NOT OVER THE NETWORK.
 *
 * Tim, 09-01: "hard to show a wow factor when you have to wait probably more than a minute", and
 * his log the same day: `swing_locate_fallback · cause dead_host · elapsed_ms 9034`, twice in one
 * afternoon.
 *
 * WHAT THE NETWORK LOCATE COSTS. When a clip carries no trimmed swing window, the review path asks
 * a vision model where the swing is: coarse frames uploaded, a cold Lambda, a 25s client budget
 * against a 60s server one. On a good day that is several seconds of dead time before anything a
 * player can see. On a bad one it aborts and the analysis drops to sampling the WHOLE clip — which
 * is the "body mechanics run before the swing even starts" complaint, and the head of the chain that
 * ends in an empty club-path trace.
 *
 * WHAT IT COSTS HERE. A swing is the fastest thing in the clip. poseMotion.deriveSwingAnchors has
 * read start/top/impact/end off the hand-speed signal since 07-21 — pure, unit-tested, no audio, no
 * labels — and the missing half was only ever the I/O: something to turn a video into pose samples.
 * expo-video-thumbnails plus MediaPipe's detectPoseFromUri do exactly that, ~100-300ms a frame. So
 * the locate is a dozen thumbnails and some arithmetic: seconds, offline, and free.
 *
 * HONESTY. This returns a WINDOW and an impact TIME — never a claimed strike. Nothing here sets
 * detectionMethod, peakDb or contact; a swing located this way still reads as video-located, and
 * tempo and ball-departure still refuse it exactly as before. Same rule as the club-path anchor:
 * measured timing may narrow a search, and may never manufacture evidence.
 * [[smartmotion-clubhead-trace-root-cause]] [[speed-is-the-wow]]
 */
/**
 * 2026-09-09 (Tim — "open smartmotion and record crashes the app… it did work before").
 *
 * THE QUEUE, NOT THE RAW MODULE. utils/videoThumbnail is a drop-in re-export that puts every native
 * frame read app-wide on ONE chain, because Android's MediaMetadataRetriever is not safe to run as
 * several concurrent instances against a file -- least of all one ExoPlayer is decoding for playback.
 * That combination is a native OOM/SIGSEGV which kills the process to the launcher and cannot be
 * caught from JS, which is why no crash for this screen ever reached the issue log.
 *
 * This module imported `expo-video-thumbnails` directly and so was never on that chain. The loop
 * below is serial WITHIN ITSELF, and the note there says "the media chain serializes them anyway" --
 * it did not, for these reads. Being serial with yourself is not the property that matters; the
 * crash is concurrency with the OTHER readers (poseDetection, clubPath, ballPath, ballDeparture,
 * feelReconcile) and with the player.
 *
 * It went from harmless to fatal on 09-01, when ad3d1216 wired the on-device locate into
 * analyzeSwing for every caller: SmartMotion's stop-recording handoff sets clipUri (the <Video>
 * mounts and starts decoding) and then runs twelve unserialized retriever reads on that same file.
 * One import; nothing else about the locate changes.
 */
import * as FileSystem from 'expo-file-system/legacy';
import * as VideoThumbnails from '../../utils/videoThumbnail';
import { wristCentroid, deriveSwingAnchors, type MotionSample } from './poseMotion';
import { traceStep } from '../analysisTrace';
/** Console + the open analysis trace (2026-10-04). */
function locNote(...a: unknown[]): void {
  console.log(...a);
  traceStep('on-device locate', { msg: a.map((x) => (typeof x === 'string' ? x.replace('[locate] ', '') : JSON.stringify(x))).join(' ') });
}

/** Enough to resolve a swing's shape; few enough to stay inside a couple of seconds. */
export const LOCATE_FRAME_COUNT = 12;
/**
 * Trim the very start and end. The record button's own transient lives there, the player is usually
 * still walking in, and a sample taken mid-press is noise that drags the derived start earlier.
 */
const HEAD_TRIM = 0.04;
const TAIL_TRIM = 0.04;
/** deriveSwingAnchors needs 5; below that its answer is not worth having. */
const MIN_USABLE_SAMPLES = 5;
/**
 * A budget, because this replaced a slow thing and must never BECOME one. On-device pose is
 * 100-300ms a frame, so twelve frames is ~2-4s; a device far slower than that is a device where the
 * network locate is the better bet. Stop sampling when the budget is spent and answer from what has
 * been collected, which is why MIN_USABLE_SAMPLES is a floor rather than a requirement to finish.
 */
const BUDGET_MS = 6_000;
/** The dense second look (see the refine pass): ~100ms steps inside the two fastest coarse gaps. */
const REFINE_STEP_MS = 100;
const REFINE_BUDGET_MS = 6_000;
const HARD_CAP_MS = 20_000;

/** Evenly spaced sample times across the usable body of the clip. Exported for the test. */
export function sampleTimesMs(durationMs: number, count: number = LOCATE_FRAME_COUNT): number[] {
  if (!Number.isFinite(durationMs) || durationMs <= 0 || count < 2) return [];
  const from = durationMs * HEAD_TRIM;
  const to = durationMs * (1 - TAIL_TRIM);
  const span = to - from;
  if (span <= 0) return [];
  return Array.from({ length: count }, (_, i) => Math.round(from + (span * i) / (count - 1)));
}

export type LocatedWindow = { startSec: number; endSec: number; swingTimeSec: number };

/**
 * Locate the swing window from on-device pose. Returns null — never throws, and never guesses — when
 * the device cannot see enough of the body, so the caller falls back to the network locate exactly
 * as it did before. A null here costs nothing; a fabricated window would cost the read.
 */
/**
 * 2026-09-09 (Tim: "locate and anchor are fundamental though") — REPORT THE LOCATE, FROM THE LOCATE.
 *
 * Wired here rather than at the call sites because there are eight of those across four files and a
 * hand-list has already been wrong twice this sprint. A mechanism reports itself, so a caller added
 * tomorrow is covered without anyone remembering. The wrapper is the whole reporting surface: the
 * implementation below is untouched and cannot be made slower or more fragile by observation.
 */
export async function locateSwingWindowOnDevice(
  clipUri: string,
  durationMs: number,
): Promise<LocatedWindow | null> {
  try {
    const out = await locateSwingWindowOnDeviceImpl(clipUri, durationMs);
    try {
      const { noteLocate } = await import('./analysisPipeline');
      noteLocate(clipUri, out ? 'ok' : 'empty', out
        ? { via: 'on_device', startSec: Math.round(out.startSec * 100) / 100, endSec: Math.round(out.endSec * 100) / 100 }
        : { via: 'on_device' });
    } catch { /* observation must never break a locate */ }
    return out;
  } catch (e) {
    try {
      const { noteLocate } = await import('./analysisPipeline');
      noteLocate(clipUri, 'failed', { via: 'on_device' });
    } catch { /* ignore */ }
    throw e;
  }
}

async function locateSwingWindowOnDeviceImpl(
  clipUri: string,
  durationMs: number,
): Promise<LocatedWindow | null> {
  if (sampleTimesMs(durationMs).length === 0) return null;

  /**
   * ON-DEVICE ONLY, DELIBERATELY. The obvious helper here is poseAnalysisApi.poseAtTime, and using it
   * would have been a bug: when the native module is missing it FALLS THROUGH TO A CLOUD PROXY, so a
   * "locate without the network" would have quietly fired a dozen network calls and been slower than
   * the single vision call it replaced. detectPoseFromUri is the native path and nothing else — it
   * returns null rather than reaching for a server.
   */
  const mp = await import('../mediaPipePoseService');
  const status = await mp.getMediaPipeStatus().catch(() => null);
  if (!status?.available) { locNote('[locate] on-device skipped: pose engine unavailable'); return null; }   // pre-build / unlinked: fall back to the network locate

  /**
   * 2026-09-09 — READ A PRIVATE COPY, NEVER THE FILE THE PLAYER HOLDS.
   *
   * The media chain (see the import note) serializes retriever against retriever. It cannot serialize
   * a retriever against ExoPlayer, which is a different subsystem, and decoding the same file the
   * player is looping is the other half of the same SIGSEGV. clubPath settled this on 07-30 and its
   * comment is explicit: "if the private copy could NOT be made, do NOT fall back to decoding the
   * ORIGINAL... on a surface that keeps looping the same file (SmartMotion review), a native retriever
   * on the file ExoPlayer is playing is the exact SIGSEGV / white-screen vector."
   *
   * This function read the ORIGINAL — on exactly the surface that comment names. SmartMotion's
   * stop-recording handoff sets clipUri, the <Video> mounts on it, and the locate then sampled twelve
   * frames off it.
   *
   * The pool is refcounted with an 8s linger, so acquiring here costs nothing the review was not
   * already going to pay: pose, tempo, club path and ball departure all take the SAME copy moments
   * later, and the locate now warms it for them instead of racing them on the original.
   *
   * No copy means no locate. That is not a new fallback — null is this function's documented answer
   * for "the device cannot see enough", and every caller already falls back to the network locate on
   * it. A missing measurement beats a crash to the launcher.
   */
  let shared: { uri: string; release: () => void } | null = null;
  try {
    const { acquireClipCopy } = await import('./sharedClipCopy');
    shared = await acquireClipCopy(clipUri);
  } catch { /* acquire failed — refused below, same as clubPath */ }
  if (!shared) { locNote('[locate] on-device skipped: no private copy of the clip'); return null; }
  const workUri = shared.uri;

  try {
    const readAt = async (tMs: number): Promise<MotionSample | null> => {
      // Serial on purpose, AND on the global media chain (see the import note) — the second half is
      // what actually holds off the other retrievers. The private copy handles the player.
      try {
        const thumb = await VideoThumbnails.getThumbnailAsync(workUri, { time: tMs, quality: 0.6 });
        const f = await mp.detectPoseFromUri(thumb.uri, undefined, tMs);
        // 2026-09-17 — delete the temp, like every other extractor in services/swing.
        void FileSystem.deleteAsync(thumb.uri, { idempotent: true }).catch(() => undefined);
        const c = f ? wristCentroid(f) : null;
        return c ? { tMs, x: c.x, y: c.y } : null;
      } catch {
        return null; // one unreadable frame is a shorter signal, not a failed locate
      }
    };
    return await searchSwingWindow(durationMs, readAt);
  } finally {
    // Every early return above lands here. Releasing decrements the refcount; the pool keeps the file
    // for another 8s so the consumers right behind this one reuse it rather than re-copying.
    shared.release();
  }
}

/**
 * The search itself, with the frame reader passed in — the device reads thumbnails through MediaPipe,
 * the test harness reads the same clip through ffmpeg + MediaPipe on a desktop. Same code either way,
 * so what the harness measures is what the phone does.
 */
export async function searchSwingWindow(
  durationMs: number,
  readAt: (tMs: number) => Promise<MotionSample | null>,
  clock: () => number = Date.now,
): Promise<LocatedWindow | null> {
  const times = sampleTimesMs(durationMs);
  if (times.length === 0) return null;
  const samples: MotionSample[] = [];
  let consecutiveMisses = 0;
  /**
   * 2026-10-03 — the budget starts at the FIRST frame that read, not at the call. A pose engine that is
   * warming up (the browser fallback loads its runtime on first use) spent the whole budget before a
   * single sample came back, so the sweep stopped at six frames, none of them on the swing.
   */
  let deadline = Number.POSITIVE_INFINITY;
  // A hard cap from the CALL as well, so a pose engine that never warms up cannot stretch three misses
  // into minutes.
  const coarseStartedAt = clock();
  const hardStop = coarseStartedAt + HARD_CAP_MS;
  for (const tMs of times) {
    if (clock() > hardStop) break;
    if (clock() > deadline) break;   // spend what is left on the answer, not on more frames
    const sample = await readAt(tMs);
    if (sample && samples.length === 0) deadline = clock() + BUDGET_MS;
    if (!sample) {
      // Bail early rather than paying for a dozen decodes that are clearly going nowhere — the
      // caller's network locate is a better use of the time than finishing a hopeless sweep.
      if (++consecutiveMisses >= 3 && samples.length === 0) { locNote('[locate] on-device gave up: first frames unreadable'); return null; }
      continue;
    }
    consecutiveMisses = 0;
    samples.push(sample);
  }
  if (samples.length < MIN_USABLE_SAMPLES) { locNote('[locate] on-device gave up: only', samples.length, 'frames read'); return null; }

  /**
   * 2026-10-03 (Tim's 14.5s upload: impact placed at 8.94s, the real strike is at 7.0s — he had
   * already turned to watch the ball). Twelve samples across a 14s clip are 1.2s apart and a
   * downswing is ~0.3s, so "the fastest wrist move between two samples" was as likely to be the
   * walk-off as the swing — and every pose frame downstream is then centred on that moment.
   *
   * REFINE: look again, densely, inside the two fastest coarse intervals. Two, not one, because the
   * coarse winner is exactly the thing in doubt (the turn-around can out-move a swing seen through a
   * 1.2s gap); at 100ms the real downswing is unmistakably the fastest motion in the clip.
   */
  const coarse = [...samples].sort((a, b) => a.tMs - b.tMs);
  const spans: { from: number; to: number; v: number }[] = [];
  for (let i = 1; i < coarse.length; i++) {
    const dt = Math.max(1, coarse[i].tMs - coarse[i - 1].tMs);
    spans.push({ from: coarse[i - 1].tMs, to: coarse[i].tMs, v: Math.hypot(coarse[i].x - coarse[i - 1].x, coarse[i].y - coarse[i - 1].y) / dt });
  }
  // Coarse-to-fine across BOTH gaps (400ms, then 200, then 100), alternating between them, so a budget
  // that runs out mid-refine still leaves both covered evenly. Filling one gap at 100ms first spent the
  // whole budget on the backswing and never looked at the downswing (measured on the emulator).
  /**
   * 2026-10-03 (review + Tim: "taking FOREVER") — the refine must not double the wait on clips the
   * coarse pass already sees well. Coarse spacing at or under ~450ms (short live captures) already
   * resolves a swing: skip it. Otherwise it gets at most half of what the coarse pass took.
   */
  const coarseSpacing = coarse.length > 1 ? (coarse[coarse.length - 1].tMs - coarse[0].tMs) / (coarse.length - 1) : 0;
  const coarseSpent = Math.max(0, clock() - coarseStartedAt);
  const refineBudget = coarseSpacing <= 450 ? 0 : Math.min(REFINE_BUDGET_MS, Math.max(2_000, coarseSpent * 0.5));
  const refineDeadline = clock() + refineBudget;
  const top2 = refineBudget > 0 ? spans.sort((a, b) => b.v - a.v).slice(0, 2) : [];
  const seen = new Set(samples.map((p) => p.tMs));
  const order: number[] = [];
  for (const step of [400, 200, REFINE_STEP_MS]) {
    for (const span of top2) {
      for (let t = span.from + step; t < span.to - 20; t += step) {
        const r = Math.round(t);
        if (!seen.has(r)) { seen.add(r); order.push(r); }
      }
    }
  }
  for (const t of order) {
    if (clock() > refineDeadline) break;
    const sample = await readAt(t);
    if (sample) samples.push(sample);
  }

  const anchors = deriveSwingAnchors(samples);
  if (!anchors) { locNote('[locate] on-device gave up: no clear swing in', samples.length, 'frames'); return null; }
  locNote('[locate] on-device', { frames: samples.length, topMs: anchors.topMs, impactMs: anchors.impactMs });
  const { startMs, endMs, impactMs } = anchors;
  if (!(Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs)) return null;

  return {
    startSec: Math.max(0, startMs / 1000),
    endSec: Math.min(durationMs / 1000, endMs / 1000),
    swingTimeSec: Math.min(Math.max(impactMs / 1000, startMs / 1000), endMs / 1000),
  };
}
