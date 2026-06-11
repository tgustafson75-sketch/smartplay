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
