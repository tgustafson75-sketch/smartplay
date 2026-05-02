import * as Location from 'expo-location';
import { useRoundStore, type ShotLocation } from '../store/roundStore';
import { haversineYards } from '../utils/geoDistance';

/**
 * Phase D-2 — SmartFinder data layer.
 *
 * Computes front / middle / back yardages from the player's current GPS position
 * to the green of the current (or specified) hole, plus a GPS-quality classification
 * for the indicator dot.
 *
 * Data source: courseHoles records on the round store (frontLat/Lng, middleLat/Lng,
 * backLat/Lng populated by golfcourseapi when available). When upstream lacks
 * green coordinates — the typical case today per Phase B field findings — every
 * yardage returns null and consumers render a graceful empty state.
 */

export type GreenYardages = {
  front: number | null;
  middle: number | null;
  back: number | null;
  hole_number: number;
};

export type GPSQualityLevel = 'strong' | 'moderate' | 'weak' | 'none';

export type GPSQualityReading = {
  level: GPSQualityLevel;
  accuracy_m: number | null;
  accuracy_ft: number | null;
};

export type LastFix = {
  location: ShotLocation;
  accuracy_m: number | null;
  timestamp: number;
};

let lastFix: LastFix | null = null;
// Phase Q.5b — sim override flag. When true, refreshFix() returns the
// caller-set lastFix instead of calling Location. Only set by the
// services/simulatedGPS.ts test harness; production code never touches.
let simulatedActive = false;

export function getLastFix(): LastFix | null {
  return lastFix;
}

/**
 * Phase Q.5b — set the cached fix directly. Used by the simulated GPS
 * test harness to feed waypoint coordinates without going through the
 * device geolocation API. Idempotent.
 */
export function setSimulatedFix(loc: ShotLocation, accuracy_m = 3): void {
  lastFix = { location: loc, accuracy_m, timestamp: Date.now() };
  simulatedActive = true;
}

/** Stop simulation and clear the cached fix so next refreshFix() hits real GPS. */
export function clearSimulatedFix(): void {
  simulatedActive = false;
  lastFix = null;
}

export function isSimulatedActive(): boolean {
  return simulatedActive;
}

/**
 * Pulls a high-accuracy GPS fix and stores accuracy alongside the location for
 * use by the GPS quality indicator. Returns null on permission denial / failure
 * (callers should show the GPS-weak state).
 */
export async function refreshFix(): Promise<LastFix | null> {
  // Sim override: just return whatever the harness set.
  if (simulatedActive) return lastFix;
  try {
    const { granted } = await Location.getForegroundPermissionsAsync();
    if (!granted) {
      const req = await Location.requestForegroundPermissionsAsync();
      if (!req.granted) return null;
    }
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    lastFix = {
      location: { lat: pos.coords.latitude, lng: pos.coords.longitude },
      accuracy_m: pos.coords.accuracy ?? null,
      timestamp: pos.timestamp,
    };
    return lastFix;
  } catch (e) {
    console.log('[smartFinder] refreshFix failed:', e);
    return null;
  }
}

export function classifyAccuracy(accuracy_m: number | null): GPSQualityReading {
  if (accuracy_m == null) {
    return { level: 'none', accuracy_m: null, accuracy_ft: null };
  }
  const accuracy_ft = Math.round(accuracy_m * 3.281);
  if (accuracy_m < 5) return { level: 'strong', accuracy_m, accuracy_ft };
  if (accuracy_m < 15) return { level: 'moderate', accuracy_m, accuracy_ft };
  return { level: 'weak', accuracy_m, accuracy_ft };
}

function safeLoc(lat: number, lng: number): ShotLocation | null {
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

/**
 * Returns front/middle/back yardages to the green of `holeNumber` (defaults to
 * the round's current hole). Each is null when either the player's location or
 * that green-point's coordinates are unknown.
 */
export async function getGreenYardages(holeNumber?: number): Promise<GreenYardages> {
  const round = useRoundStore.getState();
  const hole = holeNumber ?? round.currentHole;
  const hData = round.courseHoles.find(h => h.hole === hole);
  const fix = lastFix ?? (await refreshFix());

  if (!hData || !fix) {
    return { front: null, middle: null, back: null, hole_number: hole };
  }

  const front = safeLoc(hData.frontLat, hData.frontLng);
  const middle = safeLoc(hData.middleLat, hData.middleLng);
  const back = safeLoc(hData.backLat, hData.backLng);

  return {
    front: front ? Math.round(haversineYards(fix.location, front)) : null,
    middle: middle ? Math.round(haversineYards(fix.location, middle)) : null,
    back: back ? Math.round(haversineYards(fix.location, back)) : null,
    hole_number: hole,
  };
}

/**
 * Synchronous variant for render paths. Uses the cached lastFix without
 * awaiting; returns nulls if no fix yet. Pair with refreshFix() in a useEffect.
 */
export function getGreenYardagesSync(holeNumber?: number): GreenYardages {
  const round = useRoundStore.getState();
  const hole = holeNumber ?? round.currentHole;
  const hData = round.courseHoles.find(h => h.hole === hole);
  if (!hData || !lastFix) {
    return { front: null, middle: null, back: null, hole_number: hole };
  }
  const front = safeLoc(hData.frontLat, hData.frontLng);
  const middle = safeLoc(hData.middleLat, hData.middleLng);
  const back = safeLoc(hData.backLat, hData.backLng);
  return {
    front: front ? Math.round(haversineYards(lastFix.location, front)) : null,
    middle: middle ? Math.round(haversineYards(lastFix.location, middle)) : null,
    back: back ? Math.round(haversineYards(lastFix.location, back)) : null,
    hole_number: hole,
  };
}

/** Yardage from the player's current location to a tapped/known target point. */
export async function distanceToPoint(target: ShotLocation): Promise<number | null> {
  const fix = lastFix ?? (await refreshFix());
  if (!fix) return null;
  return Math.round(haversineYards(fix.location, target));
}
