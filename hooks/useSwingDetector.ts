import { useRef, useState, useCallback } from 'react';
import { Platform } from 'react-native';
import { Accelerometer, Gyroscope } from 'expo-sensors';

export type SwingTempo = 'fast' | 'smooth' | 'slow';

export interface SwingResult {
  tempo: SwingTempo;
  /** Duration of the swing window in milliseconds */
  tempoMs: number;
  /** Peak g-force measured during the swing */
  peakG: number;
  /** Peak forearm/wrist roll rate (rad/s) — Gyroscope Y-axis */
  peakRotY: number;
  /** Peak body yaw rotation rate (rad/s) — Gyroscope Z-axis */
  peakRotZ: number;
}

interface UseSwingDetectorOptions {
  /** Accelerometer polling rate in ms (default: 50) */
  updateIntervalMs?: number;
  /** Called every time a valid swing is detected */
  onSwing?: (result: SwingResult) => void;
}

// Phase-based detection thresholds
const ENTER_G  = 1.4;   // g-force to open a swing window
const EXIT_G   = 0.8;   // g-force to close a swing window
const PEAK_MIN = 1.8;   // minimum peak to count as a real swing (not a wrist flick)
const COOLDOWN = 1200;  // ms to block new detection after a swing fires
const MIN_MS   = 150;   // shortest valid swing window
const MAX_MS   = 2500;  // longest valid swing window

/**
 * Classifies a swing window duration into a tempo label.
 * - fast   < 500 ms
 * - smooth 500–1100 ms
 * - slow   > 1100 ms
 */
export function classifyTempo(durationMs: number): SwingTempo {
  if (durationMs < 500)  return 'fast';
  if (durationMs < 1100) return 'smooth';
  return 'slow';
}

/** Human-readable coaching feedback for a detected swing tempo. */
export function getSwingFeedback(tempo: SwingTempo): string {
  switch (tempo) {
    case 'fast':   return "That came out quick — smooth it out next one.";
    case 'smooth': return "Good tempo — stay with that.";
    case 'slow':   return "Nice and easy — just a touch more pop through impact.";
  }
}

/**
 * useSwingDetector
 *
 * Phase-based accelerometer swing detector.
 *
 * Algorithm:
 *   idle  → swinging  when g > ENTER_G (after cooldown)
 *   swinging → idle   when g < EXIT_G
 *   Valid swing = duration ∈ [MIN_MS, MAX_MS] AND peakG ≥ PEAK_MIN
 *
 * All thresholds are chosen for a phone held/worn at wrist level.
 * `onSwing` fires on every valid detection with tempo classification.
 */
export function useSwingDetector(options: UseSwingDetectorOptions = {}) {
  const { updateIntervalMs = 50, onSwing } = options;

  const [isActive, setIsActive]       = useState(false);
  const [swingCount, setSwingCount]   = useState(0);
  const [lastTempo, setLastTempo]     = useState<SwingTempo | null>(null);
  const [lastTempoMs, setLastTempoMs] = useState<number | null>(null);

  // State machine lives in refs so the addListener closure always sees current values
  const phaseRef      = useRef<'idle' | 'swinging'>('idle');
  const swingStartRef = useRef<number>(0);
  const peakGRef      = useRef<number>(0);
  const peakRotYRef   = useRef<number>(0);  // forearm roll (gyro Y)
  const peakRotZRef   = useRef<number>(0);  // body yaw (gyro Z)
  const lastEndRef    = useRef<number>(0);
  const subRef        = useRef<ReturnType<typeof Accelerometer.addListener> | null>(null);
  const gyroSubRef    = useRef<ReturnType<typeof Gyroscope.addListener> | null>(null);

  // onSwing stored in ref so the subscription closure always calls the latest version
  const onSwingRef = useRef(onSwing);
  onSwingRef.current = onSwing;

  const start = useCallback(() => {
    if (subRef.current) return; // already running
    phaseRef.current  = 'idle';
    peakGRef.current  = 0;
    peakRotYRef.current = 0;
    peakRotZRef.current = 0;
    lastEndRef.current = 0;
    setIsActive(true);

    // Accelerometer is not available on web — skip silently
    if (Platform.OS === 'web') return;

    Accelerometer.setUpdateInterval(updateIntervalMs);
    subRef.current = Accelerometer.addListener(({ x, y, z }) => {
      const g   = Math.sqrt(x * x + y * y + z * z);
      const now = Date.now();

      if (phaseRef.current === 'idle') {
        if (g > ENTER_G && now - lastEndRef.current > COOLDOWN) {
          phaseRef.current  = 'swinging';
          swingStartRef.current = now;
          peakGRef.current  = g;
          peakRotYRef.current = 0;
          peakRotZRef.current = 0;
        }
      } else {
        // Active window — track peak
        if (g > peakGRef.current) peakGRef.current = g;

        if (g < EXIT_G) {
          const duration = now - swingStartRef.current;
          phaseRef.current = 'idle';
          lastEndRef.current = now;

          if (duration >= MIN_MS && duration <= MAX_MS && peakGRef.current >= PEAK_MIN) {
            const tempo = classifyTempo(duration);
            setSwingCount((c) => c + 1);
            setLastTempo(tempo);
            setLastTempoMs(duration);
            onSwingRef.current?.({
              tempo,
              tempoMs: duration,
              peakG: peakGRef.current,
              peakRotY: peakRotYRef.current,
              peakRotZ: peakRotZRef.current,
            });
          }
        }
      }
    });

    // Gyroscope — captures rotation rates throughout the swing window
    Gyroscope.setUpdateInterval(updateIntervalMs);
    gyroSubRef.current = Gyroscope.addListener(({ y, z }) => {
      if (phaseRef.current === 'swinging') {
        if (Math.abs(y) > Math.abs(peakRotYRef.current)) peakRotYRef.current = y;
        if (Math.abs(z) > Math.abs(peakRotZRef.current)) peakRotZRef.current = z;
      }
    });
  }, [updateIntervalMs]);

  const stop = useCallback(() => {
    subRef.current?.remove();
    gyroSubRef.current?.remove();
    subRef.current    = null;
    gyroSubRef.current = null;
    phaseRef.current  = 'idle';
    setIsActive(false);
  }, []);

  const reset = useCallback(() => {
    setSwingCount(0);
    setLastTempo(null);
    setLastTempoMs(null);
  }, []);

  return { start, stop, reset, isActive, swingCount, lastTempo, lastTempoMs };
}
