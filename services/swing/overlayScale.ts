/**
 * 2026-08-31 — HOW THICK THE SKELETON IS DRAWN, as a function of the PLAYER rather than the frame.
 *
 * Extracted from components/swinglab/SwingBodyOverlay so it can be TESTED. The test written when
 * this shipped mirrored the arithmetic instead of importing it, which means it would have passed
 * even if the component had said something different — a test that proves nothing.
 * [[grep-guards-cant-see-dead-code]]
 *
 * Tim, after an on-course analysis: "the lines for body mechanics are a little thick — they don't
 * adjust to the size of the person or how far away you are. If you're eight feet away the line's
 * kind of over the player." The stroke was a fixed 0.8% of the FRAME, so filmed close it read as a
 * fine line and filmed from six or eight feet — where a swing is actually recorded — the player was
 * half the size and the line was unchanged, so it stopped tracing the body and started covering it.
 * The thickness was never wrong; it was measured against the wrong thing.
 */

/** 4% of shoulder width. Calibrated against real framing, not chosen — see the table below. */
const STROKE_PER_SHOULDER = 0.04;
/** Floor and ceiling as fractions of the frame's larger dimension. */
const MIN_FRACTION = 0.0022;
/** The CEILING is the OLD constant, so the skeleton can never come back thicker than the line Tim
 *  called too thick — whatever else changes about the maths. */
const MAX_FRACTION = 0.008;
/** Used only when there is no subject measurement at all. */
const FALLBACK_FRACTION = 0.006;

/**
 * `subjectSpan` is the player's shoulder width in the same units as `strokeBase` (the frame's larger
 * dimension). Null when pose gave us nothing to measure.
 *
 * On a portrait 1080x1920 clip, where the old fixed stroke was 15.4px at every distance:
 *
 *     very close (shoulder ~500px)  15.4px   — the cap; never THICKER than before
 *     typical    (~300px)           12.0px
 *     ~six feet  (~200px)            8.0px
 *     ~eight feet(~150px)            6.0px   — the case reported, was 15.4
 *     far        (~90px)             4.2px   — the floor; still visible
 */
export function strokeForSubject(subjectSpan: number | null | undefined, strokeBase: number): number {
  const base = Number.isFinite(strokeBase) && strokeBase > 0 ? strokeBase : 1;
  const span = subjectSpan != null && Number.isFinite(subjectSpan) && subjectSpan > 0 ? subjectSpan : null;
  const raw = span != null ? span * STROKE_PER_SHOULDER : base * FALLBACK_FRACTION;
  return Math.min(Math.max(Number.isFinite(raw) ? raw : base * FALLBACK_FRACTION, base * MIN_FRACTION), base * MAX_FRACTION);
}
