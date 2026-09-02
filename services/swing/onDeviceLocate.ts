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
 * poseAtTime already does exactly that (thumbnail -> on-device MediaPipe, ~100-300ms a frame). So
 * the locate is a dozen thumbnails and some arithmetic: seconds, offline, and free.
 *
 * HONESTY. This returns a WINDOW and an impact TIME — never a claimed strike. Nothing here sets
 * detectionMethod, peakDb or contact; a swing located this way still reads as video-located, and
 * tempo and ball-departure still refuse it exactly as before. Same rule as the club-path anchor:
 * measured timing may narrow a search, and may never manufacture evidence.
 * [[smartmotion-clubhead-trace-root-cause]] [[speed-is-the-wow]]
 */
import { poseAtTime } from '../poseAnalysisApi';
import { wristCentroid, deriveSwingAnchors, type MotionSample } from './poseMotion';

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
export async function locateSwingWindowOnDevice(
  clipUri: string,
  durationMs: number,
): Promise<LocatedWindow | null> {
  const times = sampleTimesMs(durationMs);
  if (times.length === 0) return null;

  const samples: MotionSample[] = [];
  for (const tMs of times) {
    // Serial on purpose: concurrent thumbnail reads on one file are the SIGSEGV class this app has
    // already been bitten by, and the media chain serializes them anyway.
    let frame = null;
    try {
      frame = await poseAtTime(clipUri, tMs, undefined);
    } catch {
      continue; // one unreadable frame is a shorter signal, not a failed locate
    }
    if (!frame) continue;
    const c = wristCentroid(frame);
    if (c) samples.push({ tMs, x: c.x, y: c.y });
  }
  if (samples.length < MIN_USABLE_SAMPLES) return null;

  const anchors = deriveSwingAnchors(samples);
  if (!anchors) return null;
  const { startMs, endMs, impactMs } = anchors;
  if (!(Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs)) return null;

  return {
    startSec: Math.max(0, startMs / 1000),
    endSec: Math.min(durationMs / 1000, endMs / 1000),
    swingTimeSec: Math.min(Math.max(impactMs / 1000, startMs / 1000), endMs / 1000),
  };
}
