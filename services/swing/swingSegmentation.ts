/**
 * 2026-06-07 — Swing segmentation (Smart Motion multi-swing engine).
 *
 * The Smart Motion open-window capture records ONE continuous clip while
 * the player takes however many swings they want. The acoustic strike
 * detector (services/swing/strikeDetector.ts) returns the ball-strike
 * timestamps in that window; this module turns each strike into a swing
 * SEGMENT — a [startMs, endMs] sub-range of the clip centered a little
 * before the strike (backswing) through just after (finish).
 *
 * The clip is never cut — segments are just time ranges. The reel UI
 * seeks the single Video to segment.startMs to review each swing, and
 * per-swing analysis (Phase 3) samples frames within the segment bounds.
 *
 * See memory acoustic-10-strike-calibration + smartmotion-rebuild.
 */

import type { DetectedStrike } from './strikeDetector';

/**
 * 2026-06-11 — Merge over-detections from the VIDEO swing locator. With coarse
 * locate frames ~1-1.5s apart, the model labels a SINGLE swing's backswing / top
 * / downswing frames as separate swings (verified on Tim's real clips: a 1-swing
 * down-the-line clip returned 3 detections 0.9s apart; a face-on returned 6 at
 * ~1.3s). Group detections that begin within minSepSec of the group's start into
 * ONE swing at the group's MEDIAN time (closest to impact) — a genuinely distinct
 * range swing (address a new ball → swing → reset) is always >minSepSec from the
 * next, while one swing's own phases all fall inside it. Confidence = group max.
 */
export const MIN_SWING_SEP_SEC = 2.5;

export function mergeSwingDetections(
  raw: Array<{ timeSec: number; confidence: 'high' | 'low' }>,
  minSepSec: number = MIN_SWING_SEP_SEC,
): Array<{ timeSec: number; confidence: 'high' | 'low' }> {
  if (raw.length <= 1) return raw;
  const sorted = [...raw].sort((a, b) => a.timeSec - b.timeSec);
  const out: Array<{ timeSec: number; confidence: 'high' | 'low' }> = [];
  let group: Array<{ timeSec: number; confidence: 'high' | 'low' }> = [sorted[0]];
  const flush = () => {
    const mid = group[Math.floor(group.length / 2)]; // median time ≈ impact
    const conf: 'high' | 'low' = group.some((g) => g.confidence === 'high') ? 'high' : 'low';
    out.push({ timeSec: mid.timeSec, confidence: conf });
  };
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].timeSec - group[0].timeSec < minSepSec) group.push(sorted[i]);
    else { flush(); group = [sorted[i]]; }
  }
  flush();
  return out;
}

/** A swing carved out of the open-window clip by one detected strike. */
export interface SwingSegment {
  /** 1-based swing number in the session. */
  index: number;
  /** Strike time relative to clip start (ms). */
  strikeMs: number;
  /** Segment window start (ms, clamped to clip). */
  startMs: number;
  /** Segment window end (ms, clamped to clip). */
  endMs: number;
  confidence: 'high' | 'medium' | 'low';
  peakDb: number;
  /** User has confirmed (ticked) this is a real swing. Auto-true for
   *  high/medium; low-confidence strikes start unconfirmed so the user
   *  can tick or drop them. */
  confirmed: boolean;
}

// A full swing fits comfortably here: ~2.5s back through the strike,
// ~1.5s of follow-through after. Tuned for a phone clip; clamped to the
// clip and to neighbouring strikes so two close swings don't overlap.
const PRE_STRIKE_MS = 2500;
const POST_STRIKE_MS = 1500;

export interface SegmentOptions {
  preStrikeMs?: number;
  postStrikeMs?: number;
}

/**
 * Map detected strikes → swing segments over a clip of `durationMs`.
 * Segments are clamped to the clip and trimmed at the midpoint between
 * adjacent strikes so back-to-back swings don't bleed into each other.
 */
export function segmentsFromStrikes(
  strikes: DetectedStrike[],
  durationMs: number,
  opts?: SegmentOptions,
): SwingSegment[] {
  const pre = opts?.preStrikeMs ?? PRE_STRIKE_MS;
  const post = opts?.postStrikeMs ?? POST_STRIKE_MS;
  const clamp = (v: number) => Math.max(0, Math.min(durationMs, v));

  // Strikes come time-ordered from the detector, but sort defensively.
  const ordered = [...strikes].sort((a, b) => a.timeMs - b.timeMs);

  return ordered.map((s, i) => {
    const prevStrike = ordered[i - 1];
    const nextStrike = ordered[i + 1];
    // Don't reach earlier than the midpoint to the previous strike, or
    // later than the midpoint to the next — keeps windows disjoint.
    const floorMs = prevStrike ? (prevStrike.timeMs + s.timeMs) / 2 : 0;
    const ceilMs = nextStrike ? (s.timeMs + nextStrike.timeMs) / 2 : durationMs;
    const startMs = clamp(Math.max(s.timeMs - pre, floorMs));
    const endMs = clamp(Math.min(s.timeMs + post, ceilMs));
    return {
      index: i + 1,
      strikeMs: s.timeMs,
      startMs,
      endMs,
      confidence: s.confidence,
      peakDb: s.peakDb,
      confirmed: s.confidence !== 'low',
    };
  });
}

/** Count of confirmed swings — what the UI shows as "N swings detected". */
export function confirmedCount(segments: SwingSegment[]): number {
  return segments.filter((s) => s.confirmed).length;
}

/**
 * 2026-06-10 — Range mode (acoustics off): map VIDEO-located swing times into
 * the same SwingSegment[] the acoustic path produces, so the reel + per-swing
 * analysis are identical downstream. No peakDb (no acoustics); confidence comes
 * from the visual locator. Reuses segmentsFromStrikes for windowing/clamping.
 */
export function segmentsFromVideoSwings(
  swings: Array<{ timeSec: number; confidence: 'high' | 'medium' | 'low' }>,
  durationMs: number,
  opts?: SegmentOptions,
): SwingSegment[] {
  const pseudo: DetectedStrike[] = swings.map((s) => ({
    timeMs: Math.round(s.timeSec * 1000),
    peakDb: 0,
    attackMs: 0,
    confidence: s.confidence,
  }));
  return segmentsFromStrikes(pseudo, durationMs, opts);
}

/** How close (ms) an acoustic candidate must be to a video-located swing to be
 *  accepted as that swing's impact. ~0.6s spans the slop between the visual
 *  locator's coarse frame time and the true strike instant without reaching the
 *  next swing (swings are ≥2.5s apart — see MIN_SWING_SEP_SEC). */
export const STRIKE_VIDEO_TOLERANCE_MS = 600;

/**
 * 2026-06-11 — RANGE correlation: acoustics PROPOSE *when*, vision DISPOSES *which*.
 *
 * On a busy range a mono mic can't tell your strike from the stall next door, so
 * acoustic candidates alone aren't trustworthy. But the VIDEO locator only ever
 * finds the swing that's actually in YOUR frame. So we make the video swings the
 * spine (the count is never inflated by a neighbour's sound) and let each
 * acoustic candidate, when it lands within `toleranceMs` of a video swing, donate
 * the one thing video can't give precisely: the true impact instant + its energy
 * (`peakDb`) — which is what makes honest tempo and the ball-trace anchor possible
 * on the range.
 *
 * - video swing WITH a nearby acoustic candidate → acoustic-confirmed: precise
 *   `strikeMs` + real `peakDb`, confidence upgraded to the stronger signal.
 * - video swing with NO nearby candidate → kept, visual time, `peakDb` 0 (still
 *   your swing — just not heard cleanly over the noise).
 * - acoustic candidate with NO video swing → DROPPED (a neighbour's strike).
 *
 * Reuses segmentsFromStrikes for windowing/clamping, so the reel + per-swing
 * analysis downstream are identical to every other mode (one shared spine).
 */
export function correlateStrikesWithVideo(
  strikes: DetectedStrike[],
  videoSwings: Array<{ timeSec: number; confidence: 'high' | 'medium' | 'low' }>,
  durationMs: number,
  opts?: SegmentOptions & { toleranceMs?: number },
): SwingSegment[] {
  const tol = opts?.toleranceMs ?? STRIKE_VIDEO_TOLERANCE_MS;
  const pseudo: DetectedStrike[] = videoSwings.map((sw) => {
    const tMs = Math.round(sw.timeSec * 1000);
    let best: DetectedStrike | null = null;
    let bestDist = Infinity;
    for (const s of strikes) {
      const d = Math.abs(s.timeMs - tMs);
      if (d <= tol && d < bestDist) { bestDist = d; best = s; }
    }
    if (best) {
      // Confirmed by two signals → confidence is the STRONGER of the two
      // (acoustic energy ∪ visual): a clean strike upgrades a tentative video read.
      const rank = { low: 1, medium: 2, high: 3 } as const;
      const confidence: 'high' | 'medium' | 'low' =
        rank[best.confidence] >= rank[sw.confidence] ? best.confidence : sw.confidence;
      return { timeMs: best.timeMs, peakDb: best.peakDb, attackMs: best.attackMs, confidence };
    }
    return { timeMs: tMs, peakDb: 0, attackMs: 0, confidence: sw.confidence };
  });
  return segmentsFromStrikes(pseudo, durationMs, opts);
}
