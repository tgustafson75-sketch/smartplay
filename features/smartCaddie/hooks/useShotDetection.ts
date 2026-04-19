/**
 * features/smartCaddie/hooks/useShotDetection.ts
 *
 * React hook that wraps the ShotDetection state machine and fires a callback
 * whenever a confirmed shot is detected from GPS movement alone.
 *
 * ── USAGE ────────────────────────────────────────────────────────────────────
 *
 *   const { phase, lastDetectedShot } = useShotDetection({
 *     location,                     // UnifiedLocation | null
 *     enabled: isRoundActive,
 *     onShot: (shot) => { ... },    // DetectedShot
 *   });
 *
 * ── NOTES ────────────────────────────────────────────────────────────────────
 *   • Disabled automatically when `enabled` is false (round not active).
 *   • GPS smoothing in useUnifiedGPS already removes sub-1 m noise; the
 *     detection engine adds a second independent stationary filter on top.
 *   • The hook never calls recordShot itself — the caller owns that decision
 *     so it can apply additional UI guards (e.g. suppress while modal open).
 */

import { useRef, useState, useEffect, useCallback } from 'react';
import {
  detectShot,
  INITIAL_DETECTION_STATE,
  type DetectionState,
  type DetectedShot,
  type DetectionPhase,
  type ShotSample,
} from '../engine/ShotDetection';
import type { UnifiedLocation } from '../../../core/hooks/useUnifiedGPS';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Options {
  /** Live GPS from useUnifiedGPS */
  location:          UnifiedLocation | null;
  /** Set false to pause detection (e.g. round not active) */
  enabled:           boolean;
  /** Called once per confirmed shot; do NOT call setState here — use useEffect */
  onShot:            (shot: DetectedShot) => void;
  /**
   * Optional override for false-positive suppression.
   * If this returns true the detection result is discarded.
   * Use to suppress while modal is open, during a swing with a known shot
   * already recorded, etc.
   */
  suppressIf?:       () => boolean;
}

export interface UseShotDetectionResult {
  /** Current phase of the state machine */
  phase:             DetectionPhase;
  /** The most recently confirmed shot (cleared on next detection cycle) */
  lastDetectedShot:  DetectedShot | null;
  /** Manually reset — e.g. after manual hole advance */
  reset:             () => void;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useShotDetection({
  location,
  enabled,
  onShot,
  suppressIf,
}: Options): UseShotDetectionResult {
  const stateRef    = useRef<DetectionState>(INITIAL_DETECTION_STATE);
  const onShotRef   = useRef(onShot);
  const suppressRef = useRef(suppressIf);
  const [phase, setPhase]                   = useState<DetectionPhase>('idle');
  const [lastDetectedShot, setLastDetected] = useState<DetectedShot | null>(null);

  // Keep callback refs up-to-date without recreating the effect
  useEffect(() => { onShotRef.current   = onShot;     }, [onShot]);
  useEffect(() => { suppressRef.current = suppressIf; }, [suppressIf]);

  useEffect(() => {
    if (!enabled || !location) return;

    const sample: ShotSample = {
      lat:      location.lat,
      lng:      location.lng,
      accuracy: location.accuracy,
      ts:       location.ts,
    };

    const { nextState, detectedShot } = detectShot(stateRef.current, sample);

    // Only update ref + phase when something actually changed
    if (nextState !== stateRef.current) {
      stateRef.current = nextState;
      if (nextState.phase !== phase) {
        setPhase(nextState.phase);
      }
    }

    if (detectedShot) {
      // Extra suppression check from caller (e.g. modal open, last 30 s already logged)
      if (suppressRef.current?.()) return;

      setLastDetected(detectedShot);
      onShotRef.current(detectedShot);
    }
  // `phase` intentionally omitted — we only need to compare nextState.phase
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location, enabled]);

  const reset = useCallback(() => {
    stateRef.current = INITIAL_DETECTION_STATE;
    setPhase('idle');
    setLastDetected(null);
  }, []);

  return { phase, lastDetectedShot, reset };
}
