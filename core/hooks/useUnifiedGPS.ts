/**
 * core/hooks/useUnifiedGPS.ts
 *
 * Single unified GPS source for the entire app.
 *
 * Behaviour:
 *  • Continuous watch (BestForNavigation) at 1 s / 1 m intervals.
 *  • 80/20 exponential smoothing so the player dot never jumps.
 *  • Dead-zone filtering: only emits a new value when position moves
 *    > 1 m OR distance-to-pin changes by > 1 yd — prevents UI jitter.
 *  • Exposes `distanceTo(lat, lng)` for all yardage calculations.
 *  • Falls back to the last known position on permission failure.
 *
 * Usage:
 *   const { location, distanceTo, accuracy, ready } = useUnifiedGPS();
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import * as Location from 'expo-location';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UnifiedLocation {
  lat:      number;
  lng:      number;
  accuracy: number | null; // metres
  ts:       number;        // epoch ms
}

export interface UseUnifiedGPSResult {
  /** Smoothed live location. null until first fix. */
  location:   UnifiedLocation | null;
  /** True while waiting for the first GPS fix. */
  ready:      boolean;
  /** Horizontal accuracy of the underlying fix (metres). */
  accuracy:   number | null;
  /** True when foreground permission was denied and only last-known is available. */
  permissionDenied: boolean;
  /** True when no fresh sample has arrived for STALE_TIMEOUT_MS — UI should warn. */
  stale: boolean;
  /** Re-request permission and restart the watch. Safe to call repeatedly. */
  retry: () => Promise<void>;
  /**
   * Returns yards between current location and a target coordinate.
   * Returns null if location not yet available.
   */
  distanceTo: (lat: number, lng: number) => number | null;
}

// ── Haversine distance (metres) ───────────────────────────────────────────────

function haversineMetres(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R  = 6_371_000;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;
  const a  =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const METRES_PER_YARD = 0.9144;

// ── Dead-zone constants ───────────────────────────────────────────────────────

const MIN_MOVE_METRES = 0.8; // suppress updates smaller than this
const SMOOTH_ALPHA    = 0.35; // new = 0.65 * old + 0.35 * raw — responsive yet jitter-free at walking pace
const STALE_TIMEOUT_MS = 30_000; // mark feed stale when no sample arrives for this long

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useUnifiedGPS(): UseUnifiedGPSResult {
  const [location, setLocation] = useState<UnifiedLocation | null>(null);
  const [ready,    setReady]    = useState(false);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [stale, setStale] = useState(false);

  // Refs for smoothing without triggering re-renders on every raw sample
  const smoothedRef     = useRef<UnifiedLocation | null>(null);
  const subscriptionRef = useRef<Location.LocationSubscription | null>(null);
  const lastFixAtRef    = useRef<number>(0);
  const watchdogRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelledRef    = useRef<boolean>(false);

  const start = useCallback(async () => {
    cancelledRef.current = false;

    // Stale watchdog — flips `stale` when no fresh sample for STALE_TIMEOUT_MS.
    if (watchdogRef.current == null) {
      watchdogRef.current = setInterval(() => {
        if (lastFixAtRef.current === 0) return; // not started yet
        const age = Date.now() - lastFixAtRef.current;
        setStale(age > STALE_TIMEOUT_MS);
      }, 5_000);
    }

    // ── Permission ────────────────────────────────────────────────────────────
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (cancelledRef.current) return;

    if (status !== 'granted') {
      setPermissionDenied(true);
      // Attempt last-known fallback so the UI has *something* to show.
      try {
        const last = await Location.getLastKnownPositionAsync();
        if (last && !cancelledRef.current) {
          const loc: UnifiedLocation = {
            lat:      last.coords.latitude,
            lng:      last.coords.longitude,
            accuracy: last.coords.accuracy,
            ts:       last.timestamp,
          };
          smoothedRef.current = loc;
          lastFixAtRef.current = Date.now();
          setLocation(loc);
          setAccuracy(last.coords.accuracy);
          setReady(true);
        }
      } catch { /* ignore */ }
      return;
    }

    setPermissionDenied(false);

    // ── Start continuous watch ────────────────────────────────────────────────
    subscriptionRef.current?.remove();
    subscriptionRef.current = await Location.watchPositionAsync(
      {
        accuracy:         Location.Accuracy.BestForNavigation,
        timeInterval:     1000,
        distanceInterval: 1,
      },
      (raw) => {
        if (cancelledRef.current) return;

        const { latitude: lat, longitude: lng, accuracy: acc } = raw.coords;
        const prev = smoothedRef.current;

        // Always record arrival time so the watchdog can clear staleness.
        lastFixAtRef.current = Date.now();
        if (stale) setStale(false);

        // Dead-zone: skip tiny noise
        if (prev) {
          const moved = haversineMetres(prev.lat, prev.lng, lat, lng);
          if (moved < MIN_MOVE_METRES) return;
        }

        // Exponential smoothing
        const smoothed: UnifiedLocation = prev
          ? {
              lat:      prev.lat * (1 - SMOOTH_ALPHA) + lat * SMOOTH_ALPHA,
              lng:      prev.lng * (1 - SMOOTH_ALPHA) + lng * SMOOTH_ALPHA,
              accuracy: acc,
              ts:       raw.timestamp,
            }
          : { lat, lng, accuracy: acc, ts: raw.timestamp };

        smoothedRef.current = smoothed;
        setLocation(smoothed);
        setAccuracy(acc);
        if (!ready) setReady(true);
      },
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const retry = useCallback(async () => {
    await start();
  }, [start]);

  useEffect(() => {
    void start();
    return () => {
      cancelledRef.current = true;
      subscriptionRef.current?.remove();
      subscriptionRef.current = null;
      if (watchdogRef.current) {
        clearInterval(watchdogRef.current);
        watchdogRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const distanceTo = useCallback(
    (lat: number, lng: number): number | null => {
      const loc = smoothedRef.current ?? location;
      if (!loc) return null;
      const metres = haversineMetres(loc.lat, loc.lng, lat, lng);
      return Math.round(metres / METRES_PER_YARD);
    },
    [location],
  );

  return { location, ready, accuracy, permissionDenied, stale, retry, distanceTo };
}
