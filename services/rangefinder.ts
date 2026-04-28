import { nanoid } from 'nanoid/non-secure';
import type { RangefinderLock } from '../types/smartfinder';

export interface DistanceComputeInput {
  user_position: { lat: number; lng: number; accuracy: number };
  compass_heading: number;
  tap_y_normalized: number;
  device_pitch_degrees: number;
}

export interface DistanceComputeOutput {
  distance_yards: number;
  distance_meters: number;
  target_lat: number;
  target_lng: number;
  confidence: 'high' | 'medium' | 'low';
}

const EYE_HEIGHT_M = 1.6;
const CAMERA_VFOV_DEG = 60;
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
  const { user_position, compass_heading, tap_y_normalized, device_pitch_degrees } = input;

  // Angle from horizontal: negative = looking down at ground
  // device_pitch_degrees from DeviceMotion: negative when tilted forward/down
  const tapOffsetDeg = (0.5 - tap_y_normalized) * CAMERA_VFOV_DEG;
  const angleDeg = device_pitch_degrees + tapOffsetDeg;

  let distanceM: number;
  let confidence: 'high' | 'medium' | 'low';

  if (angleDeg >= -2) {
    // Nearly level — target is far away
    distanceM = 250 * 0.9144;
    confidence = 'low';
  } else {
    const angleRad = degToRad(Math.abs(angleDeg));
    distanceM = EYE_HEIGHT_M / Math.tan(angleRad);
  }

  // Clamp to golf-realistic range
  const clampedM = Math.max(MIN_YARDS * 0.9144, Math.min(MAX_YARDS * 0.9144, distanceM));
  const distYards = clampedM / 0.9144;

  // Confidence classification
  if (angleDeg >= -2) {
    confidence = 'low';
  } else if (distYards >= 50 && distYards <= 250 && angleDeg >= -30 && angleDeg <= -5) {
    confidence = 'high';
  } else if (distYards >= 10 && distYards <= 400) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }

  const target = projectPosition(
    user_position.lat,
    user_position.lng,
    compass_heading,
    clampedM,
  );

  return {
    distance_yards: Math.round(distYards),
    distance_meters: Math.round(clampedM),
    target_lat: target.lat,
    target_lng: target.lng,
    confidence,
  };
}

export function buildLock(
  input: DistanceComputeInput,
  result: DistanceComputeOutput,
): RangefinderLock {
  return {
    id: nanoid(),
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
