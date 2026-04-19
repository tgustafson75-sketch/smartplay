/**
 * components/CourseMap.tsx
 *
 * Thin wrapper around HoleMapView that accepts a PrecisionDecision
 * and CourseHole directly, so PrecisionView doesn't need to decompose coords.
 */

import React from 'react';
import HoleMapView from './HoleMapView';
import type { HoleMapProps } from './HoleMapView';
import type { CourseHole } from '../data/courses';
import type { PlayerCoords } from '../engine/precisionEngine';

interface CourseMapProps {
  holeData: CourseHole;
  playerCoords?: PlayerCoords | null;
  gpsAccuracy?: number | null;
  yards?: { front: number | null; middle: number | null; back: number | null };
  /** Height override. Default: 260 */
  height?: number;
}

export default function CourseMap({
  holeData,
  playerCoords,
  gpsAccuracy,
  yards,
  height = 260,
}: CourseMapProps) {
  const userLocation = playerCoords
    ? { lat: playerCoords.latitude, lng: playerCoords.longitude }
    : null;

  return (
    <HoleMapView
      userLocation={userLocation}
      gpsAccuracy={gpsAccuracy ?? null}
      green={{
        front:  holeData.front,
        middle: holeData.middle,
        back:   holeData.back,
      }}
      tee={holeData.tee ?? null}
      yards={yards ?? null}
      holeLabel={`Hole ${holeData.hole}`}
      par={holeData.par}
    />
  );
}
