/**
 * 2026-05-22 — Device camera pose hook (AR Pass 2).
 *
 * Subscribes to expo-sensors DeviceMotion and exposes the phone's current
 * camera-facing pose as { headingDeg, pitchDeg, rollDeg }. The AR Shot
 * Trace overlay reads this to project the 3D trajectory into the
 * correct screen position as the player pans the camera around.
 *
 * Conventions (matches the existing smartfinder.tsx DeviceMotion usage):
 *   - heading (alpha) = 0=N, 90=E, 180=S, 270=W (compass bearing)
 *   - pitch (beta)    = 0 when phone is held vertically; negative when
 *                       the top edge tilts forward (camera looks DOWN);
 *                       positive when the top edge tilts back (camera
 *                       looks UP).
 *   - roll (gamma)    = 0 in portrait; ±90 in landscape
 *
 * Performance:
 *   - Update interval defaults to 100ms (10 Hz). The AR overlay's RAF
 *     loop runs at 30-45 fps, so 10 Hz pose updates are smooth enough
 *     while keeping sensor cost low.
 *   - Refs hold the latest value; state only updates when the value
 *     changes by more than MIN_DELTA_DEG so React doesn't re-render
 *     on every micro-tilt.
 *
 * Defensive:
 *   - When DeviceMotion fails to start (permission, simulator, web), the
 *     hook returns the neutral pose { headingDeg: 0, pitchDeg: 0, rollDeg: 0 }
 *     with available=false so the consumer can fall back to a static
 *     camera pose.
 */

import { useEffect, useRef, useState } from 'react';
import { DeviceMotion, type DeviceMotionMeasurement } from 'expo-sensors';

export interface DeviceCameraPose {
  headingDeg: number;
  pitchDeg: number;
  rollDeg: number;
  available: boolean;
  /** Timestamp (ms) of the latest sample. 0 when not yet sampled. */
  lastSampleAt: number;
}

export interface UseDeviceCameraPoseOptions {
  /** Sensor poll interval in milliseconds. Default 100ms (10 Hz). */
  updateIntervalMs?: number;
  /** State only updates when the heading or pitch moves by at least
   *  this many degrees. Reduces re-render churn. Default 0.5°. */
  minDeltaDeg?: number;
  /** Disable the subscription entirely (e.g. when the AR overlay
   *  isn't mounted). Hook returns neutral pose. */
  enabled?: boolean;
}

const DEFAULT_INTERVAL_MS = 100;
const DEFAULT_MIN_DELTA_DEG = 0.5;
const NEUTRAL_POSE: DeviceCameraPose = {
  headingDeg: 0, pitchDeg: 0, rollDeg: 0, available: false, lastSampleAt: 0,
};

export function useDeviceCameraPose(opts: UseDeviceCameraPoseOptions = {}): DeviceCameraPose {
  const {
    updateIntervalMs = DEFAULT_INTERVAL_MS,
    minDeltaDeg = DEFAULT_MIN_DELTA_DEG,
    enabled = true,
  } = opts;

  const [pose, setPose] = useState<DeviceCameraPose>(NEUTRAL_POSE);
  // Latest values in a ref so the listener can compare against the last
  // committed state without triggering re-renders.
  const committedRef = useRef<DeviceCameraPose>(NEUTRAL_POSE);

  useEffect(() => {
    if (!enabled) {
      committedRef.current = NEUTRAL_POSE;
      setPose(NEUTRAL_POSE);
      return;
    }

    let cancelled = false;
    let sub: { remove: () => void } | null = null;

    void (async () => {
      try {
        const available = await DeviceMotion.isAvailableAsync();
        if (cancelled) return;
        if (!available) {
          // expo-sensors says no DeviceMotion on this device. Stay neutral.
          return;
        }
        DeviceMotion.setUpdateInterval(updateIntervalMs);
        sub = DeviceMotion.addListener((data: DeviceMotionMeasurement) => {
          if (!data.rotation) return;
          // Convert from radians to degrees and normalize compass.
          const alphaDeg = ((data.rotation.alpha ?? 0) * 180) / Math.PI;
          const betaDeg = ((data.rotation.beta ?? 0) * 180) / Math.PI;
          const gammaDeg = ((data.rotation.gamma ?? 0) * 180) / Math.PI;
          const headingDeg = ((alphaDeg % 360) + 360) % 360;

          const prev = committedRef.current;
          const dHeading = angleDeltaAbs(headingDeg, prev.headingDeg);
          const dPitch = Math.abs(betaDeg - prev.pitchDeg);
          if (
            prev.available &&
            dHeading < minDeltaDeg &&
            dPitch < minDeltaDeg
          ) {
            return; // sub-threshold — skip re-render
          }
          const next: DeviceCameraPose = {
            headingDeg,
            pitchDeg: betaDeg,
            rollDeg: gammaDeg,
            available: true,
            lastSampleAt: Date.now(),
          };
          committedRef.current = next;
          setPose(next);
        });
      } catch {
        // No-op; consumer sees available=false and falls back.
      }
    })();

    return () => {
      cancelled = true;
      if (sub) sub.remove();
    };
  }, [enabled, updateIntervalMs, minDeltaDeg]);

  return pose;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function angleDeltaAbs(a: number, b: number): number {
  const d = Math.abs(((a - b + 540) % 360) - 180);
  return d;
}
