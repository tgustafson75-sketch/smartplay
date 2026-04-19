/**
 * features/smartCaddie/engine/ShotDetection.ts
 *
 * Pure (no React) shot-detection state machine.
 *
 * ── ALGORITHM ──────────────────────────────────────────────────────────────
 *
 *  Phase 1 — STATIONARY
 *    Player is standing still before the shot.
 *    Condition: GPS delta < STATIONARY_RADIUS_M for STATIONARY_DWELL_MS.
 *
 *  Phase 2 — LAUNCH
 *    A sudden large displacement is detected from the last stationary point.
 *    Condition: dist from stationary origin > LAUNCH_MIN_M within a single
 *    GPS tick (≈1 s), filtered by max-speed cap so cart bumps are rejected.
 *
 *  Phase 3 — FLIGHT TRACKING
 *    We continue sampling while the net displacement from the launch point
 *    keeps growing (ball rolling / bouncing).  Ends when movement stops.
 *
 *  Phase 4 — SETTLED
 *    Position stabilises again → shot end captured.
 *    If total distance < MIN_SHOT_YARDS → reject (chip/walk/noise).
 *    If confidence < CONFIDENCE_THRESHOLD → reject.
 *
 * ── SAFETY FILTERS ─────────────────────────────────────────────────────────
 *   • MAX_SPEED_M_PER_S (7 m/s ≈ 25 km/h) rejects cart movement
 *   • MIN_SHOT_YARDS (18 yd) rejects putts/tap-ins and walking
 *   • MIN_STATIONARY_MS (3.5 s) requires a genuine address phase
 *   • Global cooldown of 20 s between accepted shots
 *   • Confidence score (0–1) derived from:
 *       – stationary dwell strength
 *       – displacement intensity relative to typical range
 *       – GPS accuracy at launch
 *
 * ── UNITS ──────────────────────────────────────────────────────────────────
 *   Distance thresholds internally in METRES; exposed result in yards.
 */

import { distanceBetween, type LatLng } from '../../playView/utils/distance';

// ── Constants ────────────────────────────────────────────────────────────────

const METRES_PER_YARD         = 0.9144;

/** GPS radius within which the player counts as "stationary" */
const STATIONARY_RADIUS_M     = 1.5;

/** How long the player must be stationary before arming detection (ms) */
const STATIONARY_DWELL_MS     = 3_500;

/**
 * Minimum net displacement from launch point to count as a real shot.
 * 18 yards ≈ 16.5 m — filters walking between shots.
 */
const MIN_SHOT_M              = 18 * METRES_PER_YARD; // ~16.5 m

/** Maximum plausible ball speed — anything faster is a cart/car */
const MAX_SPEED_M_PER_S       = 7; // ~25 km/h

/**
 * After the ball lands the player walks toward it.
 * Once their speed drops below this threshold AND displacement stops growing
 * for SETTLE_DWELL_MS, the shot is finalised.
 */
const SETTLE_DWELL_MS         = 2_500;
const SETTLE_RADIUS_M         = 2.0;

/** Required confidence to accept the detection */
const CONFIDENCE_THRESHOLD    = 0.60;

/** Minimum gap between two accepted shots (ms) */
const SHOT_COOLDOWN_MS        = 20_000;

// ── Types ─────────────────────────────────────────────────────────────────────

export type DetectionPhase =
  | 'idle'          // waiting for stationary phase
  | 'stationary'    // player standing still, detection armed
  | 'inflight'      // displacement detected — tracking ball
  | 'settling';     // movement slowing — waiting to confirm landing

export interface ShotSample {
  lat:       number;
  lng:       number;
  accuracy:  number | null; // metres, null= unknown
  ts:        number;        // epoch ms
}

export interface DetectedShot {
  /** GPS position before the swing */
  start:      LatLng;
  /** GPS position after the ball lands */
  end:        LatLng;
  /** Straight-line distance in yards */
  yards:      number;
  /** 0–1 confidence score */
  confidence: number;
  /** Epoch ms of the launch detection */
  timestamp:  number;
}

export interface DetectionState {
  phase:            DetectionPhase;
  /** Epoch ms when stationary phase began */
  stationaryStart:  number | null;
  /** GPS position at start of stationary phase */
  origin:           LatLng | null;
  /** GPS position at moment of detected launch */
  launchPoint:      LatLng | null;
  /** GPS accuracy at launch (metres) */
  launchAccuracy:   number | null;
  /** Furthest displacement seen so far in flight (m) */
  maxFlightM:       number;
  /** Last position observed in flight phase */
  lastFlightPos:    LatLng | null;
  /** Epoch ms when settling started */
  settleStart:      number | null;
  /** Epoch ms of last accepted shot (cooldown) */
  lastAcceptedTs:   number;
}

export const INITIAL_DETECTION_STATE: DetectionState = {
  phase:           'idle',
  stationaryStart: null,
  origin:          null,
  launchPoint:     null,
  launchAccuracy:  null,
  maxFlightM:      0,
  lastFlightPos:   null,
  settleStart:     null,
  lastAcceptedTs:  0,
};

// ── Confidence scoring ────────────────────────────────────────────────────────

function computeConfidence(
  stationaryMs:  number,
  flightM:       number,
  accuracy:      number | null,
): number {
  // Dwell factor — peaks at STATIONARY_DWELL_MS * 2 (diminishing returns)
  const dwellScore = Math.min(stationaryMs / (STATIONARY_DWELL_MS * 2), 1);

  // Distance factor — typical drive 180 m, short iron ~100 m
  // Scales 1.0 at 60 m+, 0 at 0 m
  const distScore  = Math.min(flightM / 60, 1);

  // GPS accuracy penalty — score drops if accuracy > 10 m
  const accPenalty = accuracy !== null ? Math.max(0, 1 - (accuracy - 5) / 30) : 0.7;

  return dwellScore * 0.35 + distScore * 0.45 + accPenalty * 0.20;
}

// ── Main reducer ─────────────────────────────────────────────────────────────

/**
 * Feed each new GPS sample into this function.
 * Returns { nextState, detectedShot }.
 * `detectedShot` is non-null only when a shot is fully confirmed.
 */
export function detectShot(
  prev:    DetectionState,
  sample:  ShotSample,
): { nextState: DetectionState; detectedShot: DetectedShot | null } {

  const { lat, lng, ts, accuracy } = sample;
  const userPos: LatLng = { lat, lng };

  // ── Global cooldown guard ────────────────────────────────────────────────
  const sinceLastShot = ts - prev.lastAcceptedTs;

  // ── Compute speed from previous flight position (if in flight) ───────────
  let speedMs = 0;
  if (prev.lastFlightPos && prev.settleStart === null) {
    const dt = (ts - (prev.settleStart ?? ts - 1000)) / 1000;
    if (dt > 0) {
      speedMs = distanceBetween(prev.lastFlightPos, userPos) / Math.max(dt, 1);
    }
  }

  switch (prev.phase) {

    // ──────────────────────────────────────────────────────────────────────
    case 'idle':
    case 'stationary': {
      if (!prev.origin) {
        // First sample — set origin
        return {
          nextState: {
            ...prev,
            phase:           'stationary',
            stationaryStart: ts,
            origin:          userPos,
          },
          detectedShot: null,
        };
      }

      const drift = distanceBetween(prev.origin, userPos);

      if (drift > STATIONARY_RADIUS_M) {
        // Player moved — check speed to reject cart
        const dt = prev.stationaryStart ? (ts - prev.stationaryStart) / 1000 : 1;
        const spd = drift / Math.max(dt, 1);

        if (spd > MAX_SPEED_M_PER_S) {
          // Too fast — cart / ride. Reset
          return {
            nextState: {
              ...prev,
              phase:           'stationary',
              stationaryStart: ts,
              origin:          userPos,
              launchPoint:     null,
              launchAccuracy:  null,
              maxFlightM:      0,
              lastFlightPos:   null,
              settleStart:     null,
            },
            detectedShot: null,
          };
        }

        const dwell = prev.stationaryStart ? ts - prev.stationaryStart : 0;
        if (dwell >= STATIONARY_DWELL_MS && sinceLastShot >= SHOT_COOLDOWN_MS) {
          // LAUNCH detected
          return {
            nextState: {
              ...prev,
              phase:          'inflight',
              launchPoint:    prev.origin,
              launchAccuracy: accuracy,
              maxFlightM:     drift,
              lastFlightPos:  userPos,
              settleStart:    null,
            },
            detectedShot: null,
          };
        }

        // Moved but insufficient dwell — re-anchor
        return {
          nextState: {
            ...prev,
            phase:           'stationary',
            stationaryStart: ts,
            origin:          userPos,
            launchPoint:     null,
          },
          detectedShot: null,
        };
      }

      // Still stationary
      return {
        nextState: { ...prev, phase: 'stationary' },
        detectedShot: null,
      };
    }

    // ──────────────────────────────────────────────────────────────────────
    case 'inflight': {
      if (!prev.launchPoint) {
        return { nextState: { ...prev, phase: 'idle' }, detectedShot: null };
      }

      const flightM = distanceBetween(prev.launchPoint, userPos);
      const growing = flightM > prev.maxFlightM + SETTLE_RADIUS_M;

      if (growing) {
        return {
          nextState: {
            ...prev,
            maxFlightM:    flightM,
            lastFlightPos: userPos,
            settleStart:   null,
          },
          detectedShot: null,
        };
      }

      // Displacement stopped growing — start settle timer
      const settleStart = prev.settleStart ?? ts;
      const settling    = ts - settleStart >= SETTLE_DWELL_MS;

      if (settling) {
        return {
          nextState: { ...prev, phase: 'settling', settleStart, lastFlightPos: userPos },
          detectedShot: null,
        };
      }

      return {
        nextState: { ...prev, settleStart, lastFlightPos: userPos },
        detectedShot: null,
      };
    }

    // ──────────────────────────────────────────────────────────────────────
    case 'settling': {
      if (!prev.launchPoint || !prev.lastFlightPos) {
        return { nextState: { ...INITIAL_DETECTION_STATE, lastAcceptedTs: prev.lastAcceptedTs }, detectedShot: null };
      }

      const driftFromLast = distanceBetween(prev.lastFlightPos, userPos);

      if (driftFromLast > SETTLE_RADIUS_M && ts - (prev.settleStart ?? ts) < SETTLE_DWELL_MS * 2) {
        // Still moving — back to inflight
        const flightM = distanceBetween(prev.launchPoint, userPos);
        return {
          nextState: {
            ...prev,
            phase:         'inflight',
            maxFlightM:    Math.max(prev.maxFlightM, flightM),
            lastFlightPos: userPos,
            settleStart:   null,
          },
          detectedShot: null,
        };
      }

      // ── Shot fully settled ─────────────────────────────────────────────
      const endPoint   = prev.lastFlightPos;
      const totalM     = distanceBetween(prev.launchPoint, endPoint);
      const yards      = totalM / METRES_PER_YARD;

      if (totalM < MIN_SHOT_M) {
        // Too short — reject (putt, walk, noise)
        return {
          nextState: {
            ...INITIAL_DETECTION_STATE,
            lastAcceptedTs: prev.lastAcceptedTs,
            origin:         userPos,
            stationaryStart: ts,
            phase:          'stationary',
          },
          detectedShot: null,
        };
      }

      const stationaryMs = prev.stationaryStart
        ? (prev.launchPoint ? ts - prev.stationaryStart : STATIONARY_DWELL_MS)
        : STATIONARY_DWELL_MS;

      const confidence = computeConfidence(stationaryMs, totalM, prev.launchAccuracy);

      if (confidence < CONFIDENCE_THRESHOLD) {
        return {
          nextState: {
            ...INITIAL_DETECTION_STATE,
            lastAcceptedTs: prev.lastAcceptedTs,
            origin:         userPos,
            stationaryStart: ts,
            phase:          'stationary',
          },
          detectedShot: null,
        };
      }

      const detectedShot: DetectedShot = {
        start:      prev.launchPoint,
        end:        endPoint,
        yards:      Math.round(yards),
        confidence,
        timestamp:  ts,
      };

      return {
        nextState: {
          ...INITIAL_DETECTION_STATE,
          lastAcceptedTs: ts,
          origin:         userPos,
          stationaryStart: ts,
          phase:          'stationary',
        },
        detectedShot,
      };
    }

    default:
      return { nextState: prev, detectedShot: null };
  }
}
