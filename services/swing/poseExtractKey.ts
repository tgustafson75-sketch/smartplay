import type { SwingSegment } from './swingSegmentation';

/**
 * 2026-08-31 (OPEN-ITEMS §10) — POSE EXTRACTION USED TO WAIT FOR THE ENTIRE VISION ROUND-TRIP.
 *
 * The order was strictly serial: extract vision frames → POST /api/swing-analysis (the long pole) →
 * flip to 'review' → ONLY THEN decode the clip again for pose. The whole network wait was dead time
 * with the decoder sitting idle and the body read not yet started. I had previously told Tim these
 * ran concurrently, reasoning from the fact that they live in separate effects. They do not: the
 * biomech effect returns early unless `phase === 'review'`, and runAnalysis nulls `videoDurationMs`
 * at its start, so it was doubly blocked for the whole analysing phase.
 *
 * The fix does NOT re-gate that effect — moving the analysis state machine is how a latency tweak
 * becomes an outage. It WARMS the same cache instead, starting the identical extraction as soon as
 * the POST is in flight, so the decode happens during the network wait. The review-phase effect then
 * finds the frames already there and computes biomech immediately. Nothing about state changes, so
 * a failed or slow warm degrades to exactly today's behaviour.
 *
 * These two helpers exist so the warm and the review-phase read cannot compute DIFFERENT keys. A
 * warm that misses is strictly worse than no warm at all — it pays for a decode and then pays again
 * — so the key has exactly one owner. [[two-owners-is-the-root-cause]]
 */

/** The window + strike anchor for the swing being read. Pure; safe to call from either path. */
export function poseExtractInputsFor(segments: SwingSegment[], selectedSwing: number): {
  poseWindow: { startMs: number; endMs: number } | null;
  acousticImpactMs: number | null;
} {
  const seg = segments[selectedSwing];
  const poseWindow = seg && typeof seg.startMs === 'number' && typeof seg.endMs === 'number' && seg.endMs - seg.startMs >= 500
    ? { startMs: seg.startMs, endMs: seg.endMs }
    : null;
  // Exclude the synthesized whole-clip fallback: its strikeMs is a 0.6·duration guess, not a read.
  const acousticImpactMs = seg && seg.strikeMs != null && !seg.synthesized ? seg.strikeMs : null;
  return { poseWindow, acousticImpactMs };
}
