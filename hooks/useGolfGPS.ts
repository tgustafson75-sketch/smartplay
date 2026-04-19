/**
 * hooks/useGolfGPS.ts
 *
 * One-shot GPS with tiered fallback — designed for golf app field use.
 *
 * Fallback chain (fastest → most reliable):
 *   1. expo-location Highest accuracy   (3 s timeout)
 *   2. expo-location Balanced accuracy  (4 s timeout)
 *   3. getLastKnownPositionAsync        (instant, may be stale)
 *   4. Manual mode                      (user taps to set position)
 *
 * Battery policy:
 *   • NO continuous watch — single shot per request.
 *   • Caller triggers a refresh explicitly (hole change or "Update Yardage" tap).
 *
 * Usage:
 *   const { coords, accuracyLevel, error, isManual, manualPosition,
 *           setManualPosition, refresh } = useGolfGPS();
 *
 * Then derive yardage from coords (or manualPosition when isManual === true).
 */

import { useCallback, useRef, useState } from 'react';
import * as Location from 'expo-location';

// ─── Types ────────────────────────────────────────────────────────────────────

export type GpsAccuracyLevel = 'high' | 'balanced' | 'lastknown' | 'manual';

export interface GolfCoords {
  latitude:  number;
  longitude: number;
  /** Horizontal accuracy in metres — null when unavailable (lastknown/manual). */
  accuracy:  number | null;
  /** Epoch ms of the fix — useful for staleness checks. */
  timestamp: number;
}

export interface UseGolfGPSResult {
  /** Best available coordinates. null until first successful fix. */
  coords:        GolfCoords | null;
  /** Which tier produced the current fix. */
  accuracyLevel: GpsAccuracyLevel | null;
  /** True while an active GPS fetch is in progress. */
  loading:       boolean;
  /** Human-readable error string, or null when GPS is functional. */
  error:         string | null;
  /**
   * True when all GPS tiers failed — caller should offer the manual tap UI.
   * Yardage calculations should fall back to manualPosition or hole distance.
   */
  isManual:      boolean;
  /**
   * Manually-set position (user tap on hole map).
   * Only meaningful when isManual is true or when you want to override GPS.
   */
  manualPosition: GolfCoords | null;
  /** Store a manual tap position. Implicitly sets isManual to false (GPS no longer needed). */
  setManualPosition: (pos: GolfCoords) => void;
  /**
   * Trigger a fresh GPS fetch. Safe to call from:
   *   • hole-change useEffect
   *   • "Update Yardage" Pressable
   * No-ops when a fetch is already in progress.
   */
  refresh: () => Promise<void>;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** How long (ms) to wait before giving up on High accuracy. */
const TIMEOUT_HIGH     = 3_000;
/** How long (ms) to wait before giving up on Balanced accuracy. */
const TIMEOUT_BALANCED = 4_000;

// ─── Utility: race a promise against a timeout ────────────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('GPS timeout')), ms)
    ),
  ]);
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useGolfGPS(): UseGolfGPSResult {
  const [coords,         setCoords]         = useState<GolfCoords | null>(null);
  const [accuracyLevel,  setAccuracyLevel]  = useState<GpsAccuracyLevel | null>(null);
  const [loading,        setLoading]        = useState(false);
  const [error,          setError]          = useState<string | null>(null);
  const [isManual,       setIsManual]       = useState(false);
  const [manualPosition, setManualPositionState] = useState<GolfCoords | null>(null);

  const fetchingRef = useRef(false);

  const setManualPosition = useCallback((pos: GolfCoords) => {
    setManualPositionState(pos);
    setIsManual(false);     // manual override provided — no longer in "GPS failed" state
    setError(null);
    // Reflect the manual tap in coords so callers have a single source of truth
    setCoords(pos);
    setAccuracyLevel('manual');
  }, []);

  const refresh = useCallback(async () => {
    if (fetchingRef.current) return;   // prevent overlapping calls
    fetchingRef.current = true;
    setLoading(true);
    setError(null);
    setIsManual(false);

    try {
      // ── Step 1: Request permissions ───────────────────────────────────
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setError('Location permission denied');
        setIsManual(true);
        return;
      }

      // ── Step 2: High accuracy (3 s) ───────────────────────────────────
      try {
        const pos = await withTimeout(
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest }),
          TIMEOUT_HIGH,
        );
        const fix: GolfCoords = {
          latitude:  pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy:  pos.coords.accuracy ?? null,
          timestamp: pos.timestamp,
        };
        setCoords(fix);
        setAccuracyLevel('high');
        setError(null);
        return;
      } catch {
        // High accuracy timed out or failed — try Balanced
      }

      // ── Step 3: Balanced accuracy (4 s) ───────────────────────────────
      try {
        const pos = await withTimeout(
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
          TIMEOUT_BALANCED,
        );
        const fix: GolfCoords = {
          latitude:  pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy:  pos.coords.accuracy ?? null,
          timestamp: pos.timestamp,
        };
        setCoords(fix);
        setAccuracyLevel('balanced');
        setError(null);
        return;
      } catch {
        // Balanced also failed — try last known
      }

      // ── Step 4: Last known position ───────────────────────────────────
      try {
        const pos = await Location.getLastKnownPositionAsync();
        if (pos) {
          const fix: GolfCoords = {
            latitude:  pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy:  pos.coords.accuracy ?? null,
            timestamp: pos.timestamp,
          };
          setCoords(fix);
          setAccuracyLevel('lastknown');
          setError('GPS weak — using last known position');
          return;
        }
      } catch {
        // getLastKnownPositionAsync can throw on some platforms
      }

      // ── Step 5: All GPS tiers failed — manual mode ────────────────────
      setError('GPS unavailable — tap to set position');
      setIsManual(true);
      // Keep previous coords if we had them (allows continued yardage estimate)

    } finally {
      setLoading(false);
      fetchingRef.current = false;
    }
  }, []);

  return {
    coords,
    accuracyLevel,
    loading,
    error,
    isManual,
    manualPosition,
    setManualPosition,
    refresh,
  };
}
