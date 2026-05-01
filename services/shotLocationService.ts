import * as Location from 'expo-location';
import { useRoundStore, type ShotLocation, type CourseHole } from '../store/roundStore';

/**
 * Phase B — GPS location capture for shots.
 *
 * Two surfaces:
 *
 * 1. `getCurrentLocation()` — fetch a single high-accuracy GPS fix to populate a shot's
 *    start_location at the moment of detection. Used by the conversational logging
 *    orchestrator and any manual logging path.
 *
 * 2. `closeHoleAtTransition(holeNumber)` — called when the player advances past a hole.
 *    Sets the just-finished hole's last shot end_location to the green centroid (taken from
 *    the CourseHole record's middle-of-green coordinates). For the next hole's first shot,
 *    no special handling is needed: shotDetectionService already supplies start_location
 *    from the GPS anchor.
 *
 * The end_location of intermediate shots is back-filled by the roundStore.logShot action
 * when the next shot lands.
 */

let lastLocation: ShotLocation | null = null;

/**
 * Returns a fresh GPS fix when possible. Falls back to the last cached fix if the
 * request fails (e.g. permission denied, out of signal). Returns null if no fix is
 * available at all.
 */
export async function getCurrentLocation(): Promise<ShotLocation | null> {
  try {
    const { granted } = await Location.getForegroundPermissionsAsync();
    if (!granted) {
      const req = await Location.requestForegroundPermissionsAsync();
      if (!req.granted) return lastLocation;
    }
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    lastLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    return lastLocation;
  } catch (e) {
    console.log('[shotLocation] getCurrentLocation failed:', e);
    return lastLocation;
  }
}

/**
 * Returns the green centroid for a hole using the CourseHole record. Prefers middleLat/Lng;
 * falls back to the average of front/back when middle is missing. Returns null if neither
 * is populated.
 */
export function getGreenCentroid(holeNumber: number): ShotLocation | null {
  const holes: CourseHole[] = useRoundStore.getState().courseHoles;
  const h = holes.find(x => x.hole === holeNumber);
  if (!h) return null;
  if (h.middleLat !== 0 && h.middleLng !== 0) {
    return { lat: h.middleLat, lng: h.middleLng };
  }
  if ((h.frontLat || h.backLat) && (h.frontLng || h.backLng)) {
    return {
      lat: (h.frontLat + h.backLat) / 2,
      lng: (h.frontLng + h.backLng) / 2,
    };
  }
  return null;
}

/** Returns the tee centroid for a hole. */
export function getTeeCentroid(holeNumber: number): ShotLocation | null {
  const holes: CourseHole[] = useRoundStore.getState().courseHoles;
  const h = holes.find(x => x.hole === holeNumber);
  if (!h || (h.teeLat === 0 && h.teeLng === 0)) return null;
  return { lat: h.teeLat, lng: h.teeLng };
}

/**
 * Called when the player transitions away from `holeNumber`. Closes the last shot's
 * end_location to the green centroid of that hole. No-op if green centroid is unknown
 * or the last shot already has an end_location.
 */
export function closeHoleAtTransition(holeNumber: number): void {
  const green = getGreenCentroid(holeNumber);
  if (!green) return;
  useRoundStore.getState().closeHoleEndLocation(holeNumber, green);
}

/** For tests / debugging. */
export function _setLastLocationForTest(loc: ShotLocation | null): void {
  lastLocation = loc;
}
