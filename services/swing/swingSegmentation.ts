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
