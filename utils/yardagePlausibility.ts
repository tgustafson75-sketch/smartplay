/**
 * 2026-08-31 — IS THIS YARDAGE A REAL READING?
 *
 * Extracted from services/smartFinderService so it can be TESTED. The test written when this
 * shipped mirrored the predicate instead of importing it, which means it would have passed even if
 * the shipped clamp said something different — a test that proves nothing about the most
 * consequential number this app renders. [[grep-guards-cant-see-dead-code]]
 *
 * THE DEFECT IT EXISTS FOR: the clamps read `(yards.middle ?? 0) > maxYds`, and NaN escapes every
 * comparison — `NaN > maxYds` is false. So a non-finite yardage passed the clamp, was returned with
 * `reason: 'ok'`, and yardageResolver accepted it on a `!= null` check, rendering it as `gps_live`
 * at HIGH confidence: the tier that outranks everything else on screen. That is the "reports over
 * 7000 yards for a hole" failure wearing a different number.
 *
 * A comparison cannot reject what it cannot compare, so non-finite is refused explicitly.
 */

/**
 * True when a yardage must NOT be shown. `null`/`undefined` are NOT implausible — "no reading" is a
 * legitimate state and its own answer; only a present, unusable number is rejected here.
 */
export function isImplausibleYardage(v: number | null | undefined, maxYds: number): boolean {
  if (v == null) return false;
  if (!Number.isFinite(v)) return true;   // NaN and ±Infinity, which every comparison would admit
  if (v < 0) return true;                 // no measurement can be negative
  return v > maxYds;
}
