/**
 * gps.js — Lightweight GPS position watcher
 *
 * Requests foreground location permission and streams position updates to a
 * caller-provided callback. Returns the subscription so the caller can call
 * sub.remove() on cleanup.
 *
 * Already used in PlayScreenClean.tsx via startGpsWatch/stopGpsWatch which
 * layer on top of this with calibration and yardage computation. This module
 * provides the raw position stream for isolated use (e.g. hole-strategy engine).
 *
 * Usage:
 *   import { startLocationTracking } from '../services/gps';
 *   const sub = await startLocationTracking((coords) => console.log(coords));
 *   // cleanup:
 *   sub?.remove();
 */

import * as Location from 'expo-location';

/**
 * Start watching device position.
 *
 * @param {(coords: { latitude: number; longitude: number; accuracy?: number }) => void} onUpdate
 *   Called on every significant position change (≥5 m or ≥3 s).
 * @returns {Promise<Location.LocationSubscription | undefined>}
 *   The subscription object. Call .remove() to stop watching.
 */
export const startLocationTracking = async (onUpdate) => {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') {
    console.warn('[GPS] Location permission denied');
    return undefined;
  }

  return Location.watchPositionAsync(
    {
      accuracy: Location.Accuracy.High,
      timeInterval: 3000,    // ms — fire at most every 3 s
      distanceInterval: 5,   // m  — or when player moves 5 m
    },
    (location) => {
      onUpdate(location.coords);
    }
  );
};
