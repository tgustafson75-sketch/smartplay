import type { RangefinderLock } from '../types/smartfinder';
import { destinationPoint } from '../utils/geoDistance';

function makeId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export interface DistanceComputeInput {
  user_position: { lat: number; lng: number; accuracy: number };
  compass_heading: number;
  tap_x_normalized?: number;
  tap_y_normalized: number;
  device_pitch_degrees: number;
}

export interface DistanceComputeOutput {
  distance_yards: number;
  distance_meters: number;
  target_lat: number;
  target_lng: number;
  confidence: 'high' | 'medium' | 'low';
  /**
   * 2026-05-19 — true when the phone is held near-level and the
   * tilt-based math has no usable input. Previously the function
   * stubbed 250yd in this case and the UI displayed it. Callers must
   * branch on this and show a helpful hint instead of rendering a
   * fake number. The distance_yards / target_lat / target_lng fields
   * are still populated for back-compat (with the same 250 fallback
   * value) but should be ignored when unmeasurable is true.
   */
  unmeasurable: boolean;
}

const EYE_HEIGHT_M = 1.6;
const CAMERA_VFOV_DEG = 60;
const CAMERA_HFOV_DEG = 60;
const MIN_YARDS = 10;
const MAX_YARDS = 400;

function degToRad(d: number): number {
  return (d * Math.PI) / 180;
}

// 2026-06-14 (audit — dedup) — the local spherical destination-point projection was
// identical math to utils/geoDistance.destinationPoint (same R, same asin/atan2). Use
// the shared one; it takes yards (we already compute distYards from clampedM).

export function computeDistance(input: DistanceComputeInput): DistanceComputeOutput {
  const {
    user_position,
    compass_heading,
    tap_x_normalized = 0.5,
    tap_y_normalized,
    device_pitch_degrees,
  } = input;

  // Angle from horizontal: negative = looking down at ground
  // device_pitch_degrees from DeviceMotion: negative when tilted forward/down
  const tapOffsetDeg = (0.5 - tap_y_normalized) * CAMERA_VFOV_DEG;
  const angleDeg = device_pitch_degrees + tapOffsetDeg;

  // 2026-05-19 — when the phone is held near-level the tilt-based math
  // has no usable input (eye-height / tan(angle) requires a downward
  // angle). Previously this branch stubbed 250yd and the UI displayed
  // it as a real measurement. Now we flag the result as unmeasurable
  // so the caller can show a helpful hint instead of a fake number.
  const unmeasurable = angleDeg >= -2;

  let distanceM: number;
  if (unmeasurable) {
    // 2026-05-17 — the previous 250yd back-compat sentinel was a
    // foot-gun: callers that ignored the `unmeasurable` flag rendered
    // it as a real measurement (Tim's "every tap shows 250" finding
    // on a flat-phone STANDARD-mode session). Setting distanceM=0 so
    // the clamp below pushes the output to MIN_YARDS — clearly not a
    // real reading, no fake 250 in the UI.
    distanceM = 0;
  } else {
    const angleRad = degToRad(Math.abs(angleDeg));
    distanceM = EYE_HEIGHT_M / Math.tan(angleRad);
  }

  // Clamp to golf-realistic range
  const clampedM = Math.max(MIN_YARDS * 0.9144, Math.min(MAX_YARDS * 0.9144, distanceM));
  const distYards = clampedM / 0.9144;

  // Confidence classification
  let confidence: 'high' | 'medium' | 'low';
  if (unmeasurable) {
    confidence = 'low';
  } else if (distYards >= 50 && distYards <= 250 && angleDeg >= -30 && angleDeg <= -5) {
    confidence = 'high';
  } else if (distYards >= 10 && distYards <= 400) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }

  // Horizontal reticle displacement offsets the bearing.
  const headingOffsetDeg = (tap_x_normalized - 0.5) * CAMERA_HFOV_DEG;
  const projectedHeading = ((compass_heading + headingOffsetDeg) % 360 + 360) % 360;

  const target = destinationPoint(
    { lat: user_position.lat, lng: user_position.lng },
    projectedHeading,
    distYards,
  );

  return {
    distance_yards: Math.round(distYards),
    distance_meters: Math.round(clampedM),
    target_lat: target.lat,
    target_lng: target.lng,
    confidence,
    unmeasurable,
  };
}

// ─── Known-height ranging (2026-07-22, Tim) ─────────────────────────────────
// The tilt-based computeDistance() above physically caps at ~50 yds (a target
// farther than that sits at a <2° down-angle from eye height and reads as
// `unmeasurable`). To measure ANY distance — a 180-yd range flag, a cage target,
// a chip in the backyard — with no GPS and no course data, range off an object of
// KNOWN real-world height: the vertical angle it subtends in the frame gives the
// distance directly. distance = H / (2·tan(θ/2)), where θ is the object's angular
// height. Works at any distance; the only cost is tap precision at long range
// (zoom in to enlarge the target's frame span and tighten the read).

/** Common reference heights (metres) so the user picks a target instead of typing a number. */
export const REFERENCE_HEIGHTS: { id: string; label: string; meters: number }[] = [
  { id: 'flagstick', label: 'Flagstick (7 ft)', meters: 2.134 },
  { id: 'person', label: 'Person (5’10″)', meters: 1.778 },
  { id: 'range_flag', label: 'Range marker flag (6 ft)', meters: 1.829 },
  { id: 'golf_bag', label: 'Stand bag (3 ft)', meters: 0.914 },
  { id: 'cart', label: 'Golf cart (6 ft)', meters: 1.829 },
];

export interface HeightRangeInput {
  /** Normalized y of the target's TOP in the frame (0 = top edge, 1 = bottom edge). */
  top_y_normalized: number;
  /** Normalized y of the target's BASE in the frame. */
  base_y_normalized: number;
  /** The target's real-world height in metres. */
  real_height_m: number;
  /** Vertical field of view of the CURRENT view in degrees. Pass the zoom-adjusted
   *  FOV (base VFOV / zoom factor) so a 2× zoom doubles the angular resolution. */
  vfov_deg?: number;
}

export interface HeightRangeOutput {
  distance_yards: number;
  distance_meters: number;
  /** The object's measured angular height (degrees) — drives confidence + a "zoom in" hint. */
  angular_height_deg: number;
  confidence: 'high' | 'medium' | 'low';
  /** True when the taps coincide / height is non-positive → nothing to measure. */
  unmeasurable: boolean;
}

/** Angle (radians, positive = above frame centre) of a normalized vertical position
 *  under a rectilinear projection — the accurate mapping, not a linear FOV split. */
function angleForY(yNorm: number, vfovDeg: number): number {
  const halfTan = Math.tan(degToRad(vfovDeg) / 2);
  return Math.atan((0.5 - yNorm) * 2 * halfTan);
}

/**
 * Range off a known-height target. Deterministic, GPS-free, works at any distance.
 * Returns unmeasurable when the two taps coincide or the height is non-positive.
 */
export function computeHeightRangedDistance(input: HeightRangeInput): HeightRangeOutput {
  const vfov = input.vfov_deg && input.vfov_deg > 0 ? input.vfov_deg : CAMERA_VFOV_DEG;
  const theta = Math.abs(angleForY(input.top_y_normalized, vfov) - angleForY(input.base_y_normalized, vfov));
  const angularHeightDeg = (theta * 180) / Math.PI;

  if (!(theta > 1e-5) || !(input.real_height_m > 0)) {
    return { distance_yards: 0, distance_meters: 0, angular_height_deg: angularHeightDeg, confidence: 'low', unmeasurable: true };
  }

  const distanceM = input.real_height_m / (2 * Math.tan(theta / 2));
  const clampedM = Math.max(MIN_YARDS * 0.9144, Math.min(MAX_YARDS * 0.9144, distanceM));
  const distYards = clampedM / 0.9144;

  // Confidence scales with the target's angular size: a bigger span in the frame means
  // tap error is a smaller fraction of the measurement. Below ~0.8° the read is tap-noise
  // sensitive (zoom in) → low; above ~2.5° it's tight → high.
  let confidence: 'high' | 'medium' | 'low';
  if (angularHeightDeg >= 2.5) confidence = 'high';
  else if (angularHeightDeg >= 0.8) confidence = 'medium';
  else confidence = 'low';

  return {
    distance_yards: Math.round(distYards),
    distance_meters: Math.round(clampedM),
    angular_height_deg: angularHeightDeg,
    confidence,
    unmeasurable: false,
  };
}

export function buildLock(
  input: DistanceComputeInput,
  result: DistanceComputeOutput,
): RangefinderLock {
  return {
    id: makeId(),
    locked_at: Date.now(),
    user_position: input.user_position,
    target_position: { lat: result.target_lat, lng: result.target_lng, estimated: true },
    distance_yards: result.distance_yards,
    distance_meters: result.distance_meters,
    compass_heading: input.compass_heading,
    tap_y_normalized: input.tap_y_normalized,
  };
}

export function confidenceMargin(confidence: 'high' | 'medium' | 'low'): number {
  if (confidence === 'high') return 5;
  if (confidence === 'medium') return 10;
  return 20;
}
