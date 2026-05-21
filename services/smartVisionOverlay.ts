/**
 * Phase S — SmartVision strategic overlay layer.
 *
 * Pure logic / data computation for the overlay layers rendered on top of
 * Mapbox imagery in the SmartVision surface. Course-agnostic — works on
 * any course where Phase Q (courseGeometryService) provides geometry.
 *
 * The overlay is the long-term differentiator vs other golf apps. Mapbox
 * tiles are commodity; SmartPlay's strategic overlay is proprietary IP.
 *
 * Layers (each a pure function returning data the SVG renderer paints):
 *   1. Hole geometry (tee/green/hazards) — already in courseGeometryService
 *   2. Distance markers (yardage rings from user position)
 *   3. User position + recent shots (this hole)
 *   4. Tap-to-target (live, computed by consumer when user taps)
 *   5. Kevin's strategic annotations (landing zones, danger zones,
 *      lay-up suggestions) — the actual differentiator
 */

import type { ShotResult } from '../store/roundStore';
import type { HoleGeometry } from './courseGeometryService';
import { haversineYards } from '../utils/geoDistance';

export type LatLng = { lat: number; lng: number };

export type YardageRing = { distance_yards: number; label: string };

export type StrategicAnnotation = {
  id: string;
  kind: 'landing_zone' | 'danger_zone' | 'layup_suggestion' | 'carry_target';
  position: LatLng;
  /** Short label rendered on the overlay (≤4 chars typically). */
  label: string;
  /** Expanded copy revealed when user taps the annotation. */
  detail: string;
};

export type DangerCarry = {
  /** Distance in yards from a reference point (typically tee or user pos). */
  distance_yards: number;
  /** What the carry skips over. */
  hazard_label: string;
  /** True if the player's typical full-swing distance for the strategic club
   *  meets or exceeds this carry. */
  in_range: boolean;
};

const COMPASS_RING_YARDS = [100, 150, 200, 250, 300] as const;

/**
 * Yardage rings drawn from a reference point (typically user GPS position
 * or tee position when GPS isn't available). Filters to rings within
 * reasonable visible range of the hole length so we don't render a 300y
 * ring on a 130y par 3.
 */
export function computeYardageRings(maxRangeYards: number): YardageRing[] {
  return COMPASS_RING_YARDS
    .filter(d => d <= maxRangeYards * 1.1)
    .map(d => ({ distance_yards: d, label: `${d}y` }));
}

/**
 * Identify hazards within the player's "danger range" — i.e., hazards
 * the player can reach with their typical drive. Reads optional player
 * driver distance (Phase B accumulated data) when available.
 */
export function computeDangerCarries(
  geometry: HoleGeometry,
  playerDriverYards: number | null,
): DangerCarry[] {
  if (!geometry.tee || !playerDriverYards) return [];
  return geometry.hazards
    .filter(h => h.location != null)
    .map(h => {
      const dist = haversineYards(geometry.tee!, h.location!);
      return {
        distance_yards: Math.round(dist),
        hazard_label: h.label,
        in_range: playerDriverYards >= dist - 10,
      };
    })
    .filter(c => c.distance_yards <= playerDriverYards * 1.2);
}

/**
 * Suggest a strategic lay-up target on a par 4 or par 5 when the player
 * has a hazard in their drive range. Heuristic: lay up to a comfortable
 * approach distance for a wedge or short iron.
 */
export function computeLayupSuggestion(
  geometry: HoleGeometry,
  carries: DangerCarry[],
): StrategicAnnotation | null {
  if (geometry.par < 4) return null;
  const hazardInRange = carries.find(c => c.in_range);
  if (!hazardInRange) return null;
  if (!geometry.tee || !geometry.green) return null;

  // Lay-up target: a point on the tee→green axis, at a distance from the
  // green that leaves a comfortable wedge (typically 100-110 yards).
  const totalDist = haversineYards(geometry.tee, geometry.green);
  const targetDistFromTee = Math.max(hazardInRange.distance_yards - 30, totalDist - 110);
  const t = targetDistFromTee / totalDist;

  return {
    id: 'layup-' + geometry.hole_number,
    kind: 'layup_suggestion',
    position: {
      lat: geometry.tee.lat + (geometry.green.lat - geometry.tee.lat) * t,
      lng: geometry.tee.lng + (geometry.green.lng - geometry.tee.lng) * t,
    },
    label: 'LU',
    detail: `Lay up short of the ${hazardInRange.hazard_label}. Leaves you about ${Math.round(totalDist - targetDistFromTee)} yards in.`,
  };
}

/**
 * Annotated landing zone — where Kevin would aim a typical drive on this
 * hole, factoring in hazard avoidance and player distance. Returns null
 * when geometry is too thin to compute.
 */
export function computeLandingZone(
  geometry: HoleGeometry,
  playerDriverYards: number | null,
): StrategicAnnotation | null {
  if (!geometry.tee || !geometry.green) return null;
  if (geometry.par < 4) return null;
  const distance = playerDriverYards ?? 230;
  const totalDist = haversineYards(geometry.tee, geometry.green);
  const t = Math.min(distance / totalDist, 0.85);

  return {
    id: 'landing-' + geometry.hole_number,
    kind: 'landing_zone',
    position: {
      lat: geometry.tee.lat + (geometry.green.lat - geometry.tee.lat) * t,
      lng: geometry.tee.lng + (geometry.green.lng - geometry.tee.lng) * t,
    },
    label: 'LZ',
    detail: `Target zone — about ${Math.round(distance)} yards from the tee.`,
  };
}

/**
 * Distance from current position (or tee, if no GPS) to a tapped target.
 * Used by the tap-to-target interaction.
 */
export function distanceToTarget(from: LatLng | null, target: LatLng): number {
  if (!from) return 0;
  return Math.round(haversineYards(from, target));
}

/** Carry feasibility check for the "can I carry the bunker" voice query. */
export function canPlayerCarry(
  from: LatLng,
  hazardEdge: LatLng,
  playerClubYards: number,
): { carry_yards: number; in_range: boolean; margin_yards: number } {
  const carry = Math.round(haversineYards(from, hazardEdge));
  const margin = playerClubYards - carry;
  return { carry_yards: carry, in_range: margin >= 0, margin_yards: margin };
}

/**
 * Filter recent shots to just those on the active hole, ordered by time.
 * Used by the user-trace layer to draw the connect-the-dots path.
 */
export function shotsForHole(allShots: ShotResult[], holeNumber: number): ShotResult[] {
  return allShots
    .filter(s => s.hole === holeNumber)
    .sort((a, b) => a.timestamp - b.timestamp);
}

// ─── Math helpers (pure) ──────────────────────────────────────────────────

// 2026-05-21 — Consolidation 1: local haversineYards removed in favor of
// utils/geoDistance.ts canonical. Prior local used atan2(sqrt(h), sqrt(1-h))
// vs canonical asin(sqrt(h)) — mathematically identical within float
// precision for any practical golf-course distance, and the canonical
// METERS_PER_YARD = 0.9144 is the exact rational definition while the
// local 1.09361 was a rounded reciprocal (max ~0.001y drift at 300y,
// invisible).

// Used by the local-tangent-plane projection below (NOT haversine).
const R_METERS = 6371000;

/**
 * Project a [lat, lng] onto pixel coordinates within a static-tile image
 * given the image's center, zoom, and bearing. This is the inverse of
 * the Mapbox Static Images projection — needed so the SVG overlay
 * markers land on the correct pixels of the rendered tile.
 *
 * For a Web Mercator projection at the given zoom level, 1 pixel ≈
 *   metersPerPixel = (156543.03392 * cos(lat)) / 2^zoom
 * yards-per-pixel = metersPerPixel × 1.09361
 *
 * We compute relative offsets in yards from center, then convert back
 * to pixel offsets, then apply the bearing rotation (so a hole oriented
 * tee-bottom → green-top stays vertical regardless of compass heading).
 */
export function projectToTilePixels(
  point: LatLng,
  center: LatLng,
  zoom: number,
  bearingDeg: number,
  imgWidth: number,
  imgHeight: number,
): { x: number; y: number } {
  const metersPerPixel = (156543.03392 * Math.cos(center.lat * Math.PI / 180)) / Math.pow(2, zoom);

  // Local-tangent-plane offsets in meters
  const dx_m = (point.lng - center.lng) * (Math.PI / 180) * R_METERS * Math.cos(center.lat * Math.PI / 180);
  const dy_m = (point.lat - center.lat) * (Math.PI / 180) * R_METERS;

  // Pixel offsets (image y axis points down; lat increases northward → invert)
  const dx_px = dx_m / metersPerPixel;
  const dy_px = -dy_m / metersPerPixel;

  // Apply bearing rotation. Bearing rotates the tile so the hole axis is
  // vertical; we rotate points by the negative of that bearing to land
  // on the same pixels the tile renderer placed them.
  const θ = -bearingDeg * Math.PI / 180;
  const cosθ = Math.cos(θ);
  const sinθ = Math.sin(θ);
  const x_rot = dx_px * cosθ - dy_px * sinθ;
  const y_rot = dx_px * sinθ + dy_px * cosθ;

  return {
    x: imgWidth / 2 + x_rot,
    y: imgHeight / 2 + y_rot,
  };
}
