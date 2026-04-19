/**
 * hooks/useGpsEngine.ts
 *
 * Self-contained GPS yardage engine hook.
 *
 * Features implemented:
 *   ✓ Expo Location (Balanced accuracy — battery efficient)
 *   ✓ Permission request
 *   ✓ Seed read (instant first yardage)
 *   ✓ watchPositionAsync — 10 s / 5 m interval
 *   ✓ 5-reading rolling average (smoothFMB from utils/distance)
 *   ✓ Noise gate  (< 3 yards change → drop)
 *   ✓ Jump clamp  (> 50 yards leap → drop unless hole changed)
 *   ✓ Accuracy-based weak signal (coords.accuracy > 20 m)
 *   ✓ Timeout-based watchdog (30 s no tick → weak)
 *   ✓ State debounce (750 ms normal, 5 s low-power)
 *   ✓ Calibrated-pin mode (caller-supplied centre-pin → F/M/B derived)
 *   ✓ Static fallback (use hole distance when GPS unavailable)
 *   ✓ Stable refs — watcher callback never re-creates
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import {
  computeFMB,
  computeFMBFromCalibrated,
  smoothFMB,
  shouldDiscard,
  isWeakAccuracy,
  type FMBYardages,
  type GreenTargets,
  type ReadingBuffer,
} from '../utils/distance';

// ─── Configuration ────────────────────────────────────────────────────────────

const WATCH_INTERVAL_MS   = 10_000; // poll every 10 seconds
const WATCH_DISTANCE_M    = 5;      // …or when player moves 5 m
const DEBOUNCE_MS         = 750;    // minimum gap between state updates
const DEBOUNCE_LOW_POWER  = 5_000;  // in low-power mode, render even less
const WATCHDOG_TIMEOUT_MS = 30_000; // declare "weak" if no tick for 30 s

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CalibratedPin {
  lat: number;
  lng: number;
}

export interface GpsEngineOptions {
  /** Index of the active hole (1-based). Used only to detect hole changes for jump-clamp logic. */
  holeNumber: number;
  /**
   * Green target coordinates for F / M / B.
   * When a calibrated pin is supplied it takes priority over targets.
   */
  greenTargets: GreenTargets | null;
  /** If provided, overrides greenTargets.middle and derives F/B from depth estimate. */
  calibratedPin?: CalibratedPin | null;
  /** Nominal hole distance (yards), used for depth estimate and static fallback. */
  holeDistance?: number;
  /** Disable frequent re-renders; debounce extends to 5 s. */
  lowPowerMode?: boolean;
  /**
   * Called when fresh yardages are computed. Useful for voice announcements.
   * Value is the smoothed middle yardage.
   */
  onNewYardage?: (yards: FMBYardages) => void;
}

export interface GpsEngineState {
  /** Latest smoothed F / M / B yardages. null until first fix. */
  yards:   FMBYardages | null;
  /** True when GPS signal is unreliable (accuracy > 20 m OR no tick for 30 s). */
  weak:    boolean;
  /** True while waiting for the first location fix. */
  loading: boolean;
  /** Last known GPS accuracy in metres. null if unknown. */
  accuracy: number | null;
  /** Manually restart the GPS watcher (e.g. after a permission grant). */
  restart: () => void;
  /** Stop the watcher (call on screen unmount). */
  stop:    () => void;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useGpsEngine(opts: GpsEngineOptions): GpsEngineState {
  // ── State (only these trigger re-renders) ───────────────────────────────
  const [yards,    setYards]    = useState<FMBYardages | null>(null);
  const [weak,     setWeak]     = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [accuracy, setAccuracy] = useState<number | null>(null);

  // ── Stable refs (watcher callback reads these without stale closures) ───
  const watchRef        = useRef<Location.LocationSubscription | null>(null);
  const yardsRef        = useRef<FMBYardages | null>(null);
  const bufferRef       = useRef<ReadingBuffer>([]);
  const holeRef         = useRef(opts.holeNumber);
  const prevHoleRef     = useRef(opts.holeNumber);
  const targetsRef      = useRef(opts.greenTargets);
  const calPinRef       = useRef(opts.calibratedPin ?? null);
  const holeDistRef     = useRef(opts.holeDistance ?? 360);
  const lowPowerRef     = useRef(opts.lowPowerMode ?? false);
  const onNewYardageRef = useRef(opts.onNewYardage);

  const debounceRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const watchdogRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep refs in sync with latest prop values every render
  holeRef.current         = opts.holeNumber;
  targetsRef.current      = opts.greenTargets;
  calPinRef.current       = opts.calibratedPin ?? null;
  holeDistRef.current     = opts.holeDistance ?? 360;
  lowPowerRef.current     = opts.lowPowerMode ?? false;
  onNewYardageRef.current = opts.onNewYardage;

  // Detect hole change (for jump-clamp bypass)
  const isHoleChanged = (): boolean => {
    const changed = holeRef.current !== prevHoleRef.current;
    if (changed) {
      prevHoleRef.current = holeRef.current;
      bufferRef.current   = []; // reset smoothing buffer on hole change
    }
    return changed;
  };

  // ── Watchdog ────────────────────────────────────────────────────────────
  const rescheduleWatchdog = useCallback(() => {
    if (watchdogRef.current) clearTimeout(watchdogRef.current);
    watchdogRef.current = setTimeout(() => {
      watchdogRef.current = null;
      setWeak(true);
    }, WATCHDOG_TIMEOUT_MS);
  }, []);

  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  }, []);

  // ── Compute yards from a given player position ──────────────────────────
  const compute = useCallback((lat: number, lon: number): FMBYardages => {
    const cal = calPinRef.current;
    if (cal) {
      return computeFMBFromCalibrated(lat, lon, cal.lat, cal.lng, holeDistRef.current);
    }
    const targets = targetsRef.current;
    if (!targets) {
      // No GPS targets — static fallback derived from hole distance
      const d = holeDistRef.current;
      const depth = Math.max(12, Math.round(d * 0.04));
      return { front: d - depth, middle: d, back: d + depth };
    }
    return computeFMB(lat, lon, targets);
  }, []);

  // ── Flush a new reading to state (debounced) ────────────────────────────
  const flushYards = useCallback((raw: FMBYardages, coordAccuracy: number | null) => {
    // Accuracy-based weak check (hardware signal quality)
    const accuracyWeak = isWeakAccuracy(coordAccuracy);

    // Smooth the new reading through the rolling window
    const { smoothed, updatedBuffer } = smoothFMB(raw, bufferRef.current);
    bufferRef.current = updatedBuffer;
    yardsRef.current  = smoothed;

    setAccuracy(coordAccuracy);
    if (accuracyWeak) {
      setWeak(true);
    } else {
      setWeak(false);
    }

    // Notify caller (e.g. for voice announcements) — always with latest value
    if (smoothed.middle != null) {
      onNewYardageRef.current?.(smoothed);
    }

    // Debounce the React state update to prevent per-GPS-tick re-renders
    const delay = lowPowerRef.current ? DEBOUNCE_LOW_POWER : DEBOUNCE_MS;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      setYards(smoothed);
    }, delay);
  }, []);

  // ── Core watcher logic ──────────────────────────────────────────────────
  const startWatch = useCallback(async () => {
    if (watchRef.current) return; // already running

    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;

      setLoading(true);

      // Seed: instant first reading
      const initial = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setLoading(false);

      const { latitude, longitude, accuracy: acc } = initial.coords;
      const raw = compute(latitude, longitude);
      flushYards(raw, acc ?? null);
      rescheduleWatchdog();

      // Continuous watcher
      watchRef.current = await Location.watchPositionAsync(
        {
          accuracy:         Location.Accuracy.Balanced,
          timeInterval:     WATCH_INTERVAL_MS,
          distanceInterval: WATCH_DISTANCE_M,
        },
        (loc) => {
          const { latitude: lat, longitude: lon, accuracy: locAcc } = loc.coords;
          const raw2 = compute(lat, lon);

          const holeChanged = isHoleChanged();
          if (shouldDiscard(yardsRef.current?.middle ?? null, raw2.middle, holeChanged)) {
            // Even on a discarded tick: restart watchdog (signal is alive)
            rescheduleWatchdog();
            return;
          }

          rescheduleWatchdog();
          flushYards(raw2, locAcc ?? null);
        },
      );
    } catch {
      // GPS unavailable — use static fallback
      setLoading(false);
      setWeak(true);

      const d = holeDistRef.current;
      const depth = Math.max(12, Math.round(d * 0.04));
      const fallback: FMBYardages = { front: d - depth, middle: d, back: d + depth };
      yardsRef.current = fallback;
      setYards(fallback);
    }
  }, [compute, flushYards, rescheduleWatchdog]);

  const stopWatch = useCallback(() => {
    watchRef.current?.remove();
    watchRef.current = null;
    clearWatchdog();
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    setWeak(false);
  }, [clearWatchdog]);

  // ── Lifecycle ───────────────────────────────────────────────────────────
  useEffect(() => {
    void startWatch();
    return () => stopWatch();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // start once on mount; stop on unmount

  return {
    yards,
    weak,
    loading,
    accuracy,
    restart: startWatch,
    stop:    stopWatch,
  };
}
