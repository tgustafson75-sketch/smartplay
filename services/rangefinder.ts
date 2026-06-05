import type { RangefinderLock } from '../types/smartfinder';

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

function projectPosition(
  lat: number,
  lng: number,
  headingDeg: number,
  distanceM: number,
): { lat: number; lng: number } {
  const R = 6371000;
  const latR = degToRad(lat);
  const headR = degToRad(headingDeg);
  const dR = distanceM / R;

  const newLatR = Math.asin(
    Math.sin(latR) * Math.cos(dR) +
      Math.cos(latR) * Math.sin(dR) * Math.cos(headR),
  );
  const newLngR =
    degToRad(lng) +
    Math.atan2(
      Math.sin(headR) * Math.sin(dR) * Math.cos(latR),
      Math.cos(dR) - Math.sin(latR) * Math.sin(newLatR),
    );

  return {
    lat: (newLatR * 180) / Math.PI,
    lng: (newLngR * 180) / Math.PI,
  };
}

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

  const target = projectPosition(
    user_position.lat,
    user_position.lng,
    projectedHeading,
    clampedM,
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
