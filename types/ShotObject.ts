/**
 * ShotObject.ts
 *
 * Canonical shot data structure shared across:
 *   - PracticeScreen (practice.tsx)
 *   - DispersionMap
 *   - VisionEngine / BallTrackingEngine
 *   - CaddieMemory
 *   - PlayScreenClean
 *   - SessionHistory / TrendEngine
 *
 * All modules must produce / consume this shape.
 * Optional fields are marked with `?`.
 */

/** Outcome direction of the shot */
export type ShotResult = 'good' | 'straight' | 'left' | 'right';

/**
 * Where the ball started relative to the intended line.
 * 'neutral' = on-line (replaces 'straight' for start-direction).
 */
export type BallStartDirection = 'left' | 'right' | 'neutral';

/** Dominant ball flight curve */
export type ShotShape =
  | 'slice' | 'fade' | 'straight' | 'draw' | 'hook'
  | 'push'  | 'pull' | 'neutral';

/** Strike quality */
export type ContactType = 'fat' | 'thin' | 'clean' | 'toe' | 'heel' | 'dead-center';

/** Subjective feel */
export type FeelRating = 'great' | 'good' | 'ok' | 'poor';

// ─── Canonical Shot Object ─────────────────────────────────────────────────────

export interface ShotObject {
  /** UUID, e.g. crypto.randomUUID() or Date.now()-based */
  id:          string;
  /** Session that produced this shot */
  sessionId:   string;
  /** Final outcome direction */
  result:      ShotResult;
  /** Start-line direction (from BallTrackingEngine) */
  ballStart?:  BallStartDirection;
  /** Derived ball flight shape */
  shotShape?:  ShotShape;
  /** Strike quality */
  contact?:    ContactType;
  /** Player's subjective feel */
  feel?:       FeelRating;
  /** Intended aim target (text) */
  target?:     string;
  /** Club used */
  club?:       string;
  /** Unix ms */
  timestamp:   number;
  /** Recorded video URI for this shot */
  videoUri?:   string;
  /** Whether vision detected a mismatch between result and ballStart */
  mismatch?:   boolean;
  /** Distance to pin at time of shot (yards) */
  distance?:   number;
  /** Golf hole number (play mode) */
  hole?:       number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Classify shot shape from start direction + finish direction */
export function classifyShotShape(
  ballStart: BallStartDirection,
  finish: 'left' | 'straight' | 'right',
): ShotShape {
  if (ballStart === 'right') {
    if (finish === 'right')    return 'push';
    if (finish === 'left')     return 'slice';
    return 'fade';
  }
  if (ballStart === 'left') {
    if (finish === 'right')    return 'draw';
    if (finish === 'left')     return 'pull';
    return 'hook';
  }
  // neutral start
  if (finish === 'right')      return 'fade';
  if (finish === 'left')       return 'draw';
  return 'straight';
}

/** Convert a ShotResult to a BallStartDirection default when no vision data available */
export function resultToBallStart(result: ShotResult): BallStartDirection {
  if (result === 'left')  return 'left';
  if (result === 'right') return 'right';
  return 'neutral';
}

/** Generate a lightweight shot ID */
export function makeShotId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Generate a session ID (call once at session start) */
export function makeSessionId(): string {
  return `sess-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
