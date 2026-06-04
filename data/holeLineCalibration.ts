/**
 * 2026-05-26 — Fix BK: hole-image line calibration scaffold.
 *
 * Tim's insight: the white tee→green line baked into every 18Birdies
 * hole screenshot is a gift — it tells us EXACTLY where the
 * SmartVision measuring tool (yellow target dot + F/M/B yardages)
 * should sit by default. The default tee position, default target
 * position (somewhere along the line), and default pin position can
 * all be derived from two pixel coordinates per hole.
 *
 * This module ships the DATA SHAPE today; per-hole line endpoints are
 * left empty for V1 and will be populated as one of:
 *   1. Manual tagging: open each image, eyeball tee + green pixels,
 *      enter coords. Slow but accurate (36 holes × ~30s each = ~18 min
 *      of one-time work).
 *   2. Auto-detect: the 18Birdies line is a known shade of white
 *      (~#FFFFFF, ~3px wide). A simple CV pass (edge detect + Hough
 *      transform) can find both endpoints reliably. Defer to a Python
 *      one-off if manual tagging proves tedious.
 *
 * Coordinate system: pixel coords on the CROPPED image (1768×1450 as
 * of Batch 45). Origin top-left, x=horizontal, y=vertical (matches
 * RN's image-source coord system).
 *
 * Consumer (a future batch): app/smartvision.tsx local-image fallback
 * branch reads getHoleLineCalibration(slug, hole) and:
 *   - Places yellow target at line midpoint by default
 *   - Pins T marker at tee endpoint
 *   - Pins P marker at green endpoint
 *   - Yardage labels project from the line geometry
 */

import type { LocalCourseSlug } from './localCourseImages';

export interface HoleLineEndpoints {
  /** Tee pixel coordinates (typically near the bottom of the image). */
  tee: { x: number; y: number };
  /** Green-center pixel coordinates (typically near the top). */
  green: { x: number; y: number };
}

/**
 * Per-course, per-hole line endpoint registry. Populate via manual
 * tagging or CV auto-detect. Holes not present here fall back to the
 * old behavior (Mapbox geometry OR center-of-image default).
 *
 * Convention for empty courses: don't define the slug at all — the
 * lookup helper returns null for missing entries.
 */
export const HOLE_LINE_CALIBRATION: Partial<Record<LocalCourseSlug, Record<number, HoleLineEndpoints>>> = {
  // Maplewood / Settlers Crossing (Bethlehem NH) — 18B screenshots,
  // 1768×1450 cropped. Coords below are MANUAL VISUAL ESTIMATES
  // (±50-100px accuracy) from inspecting each cropped image. Holes
  // not listed fall through to the static (50%, 85%) / (50%, 15%)
  // default in app/smartvision.tsx — which is fine for holes whose
  // line is roughly center-vertical (most of them).
  //
  // Listed here only when the line is noticeably OFF the centered
  // axis OR when the green/tee endpoint sits well outside the
  // default y bands (very short par 3s, doglegs, hazard wraps).
  //
  // Future: replace estimates with OpenCV-detected endpoints (the
  // 18B line is uniform ~#FFFFFF + ~3px wide — Hough transform
  // finds both endpoints reliably).
  // 2026-06-04 — Maplewood entry removed alongside the course bundle.
  // Re-add when Maplewood gets an IP-clean re-bundle.
  palms: {
    // Hole 9: par 5, 503Yds. Line bends right around the water hazard;
    // tee at bottom-right, green near top-center. Big calibration win
    // vs the centered-axis static fallback which would land the yellow
    // dot in the middle of the water.
    9: { tee: { x: 1025, y: 1247 }, green: { x: 920, y: 73 } },
  },
};

/**
 * Lookup helper. Returns null when no calibration exists for the
 * given course/hole pair (renderer should fall through to default
 * center-of-image placement).
 */
export function getHoleLineCalibration(
  slug: LocalCourseSlug | null,
  holeNumber: number,
): HoleLineEndpoints | null {
  if (!slug) return null;
  const courseMap = HOLE_LINE_CALIBRATION[slug];
  if (!courseMap) return null;
  return courseMap[holeNumber] ?? null;
}

/**
 * Derive a fractional point along the tee→green line.
 *
 *   0.0 → at tee
 *   0.5 → midpoint (sensible default for the yellow target)
 *   1.0 → at green
 *
 * Returns null when the calibration isn't available so consumers
 * can degrade gracefully (e.g. center of the image, or whatever the
 * existing fallback was).
 */
export function pointAlongHoleLine(
  slug: LocalCourseSlug | null,
  holeNumber: number,
  fraction: number,
): { x: number; y: number } | null {
  const line = getHoleLineCalibration(slug, holeNumber);
  if (!line) return null;
  const f = Math.max(0, Math.min(1, fraction));
  return {
    x: Math.round(line.tee.x + (line.green.x - line.tee.x) * f),
    y: Math.round(line.tee.y + (line.green.y - line.tee.y) * f),
  };
}
