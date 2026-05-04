/**
 * hooks/useHoleProgression.ts
 *
 * React hook that wraps the HoleProgression state machine and drives
 * automatic hole advancement via the round store.
 *
 * Features:
 *   • 5-second green dwell before completion is armed
 *   • 35 m departure guard before advancing
 *   • 2-second confirmation delay to ride out GPS noise on the green edge
 *   • Never jumps more than +1 hole
 *   • Disabled when !isRoundActive or when currentHole === 18
 *   • Resets cleanly on manual hole change
 */

import { useEffect, useRef, useCallback } from 'react';
import {
  progressionReducer,
  INITIAL_PROGRESSION,
  type HoleCoords,
  type ProgressionState,
} from '../features/playView/engine/HoleProgression';
import type { UnifiedLocation } from '../core/hooks/useUnifiedGPS';
import type { Course } from '../data/courses';

// ── Config ────────────────────────────────────────────────────────────────────

/** Delay (ms) between "completed" state and actually advancing to next hole */
const ADVANCE_DELAY_MS = 2_000;

// ── Hook ─────────────────────────────────────────────────────────────────────

interface Options {
  location:       UnifiedLocation | null;
  currentHole:    number;
  setCurrentHole: (h: number) => void;
  isRoundActive:  boolean;
  courseData:     Course | null;
  /**
   * Stale-GPS flag from the unified GPS hook. When true, `location` still
   * holds the last good fix but the watch has not received a fresh sample
   * for STALE_TIMEOUT_MS — auto-advance is paused so a frozen position
   * inside the green's dwell radius cannot trigger hole progression.
   */
  stale?:         boolean;
  /** Called when a new hole is about to start — used to show the toast */
  onHoleAdvance?: (from: number, to: number) => void;
}

export function useHoleProgression({
  location,
  currentHole,
  setCurrentHole,
  isRoundActive,
  courseData,
  stale = false,
  onHoleAdvance,
}: Options): void {
  const stateRef      = useRef<ProgressionState>(INITIAL_PROGRESSION);
  const advTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastHoleRef   = useRef<number>(currentHole);

  // Reset state machine when the active hole changes (manual or auto)
  useEffect(() => {
    if (lastHoleRef.current !== currentHole) {
      lastHoleRef.current = currentHole;
      stateRef.current    = INITIAL_PROGRESSION;
      if (advTimerRef.current) {
        clearTimeout(advTimerRef.current);
        advTimerRef.current = null;
      }
    }
  }, [currentHole]);

  const advance = useCallback(() => {
    const next = lastHoleRef.current + 1;
    if (next > 18) return;
    onHoleAdvance?.(lastHoleRef.current, next);
    setCurrentHole(next);
  }, [setCurrentHole, onHoleAdvance]);

  useEffect(() => {
    if (!isRoundActive || !location || currentHole >= 18) return;
    // Pause auto-advance while GPS is stale — the location ref may be frozen
    // inside the dwell radius of the green even though the player has moved.
    if (stale) return;

    // Build hole coords from COURSE_DB
    const holeData = courseData?.holes[currentHole - 1];
    if (!holeData) return;

    const coords: HoleCoords = {
      tee:   holeData.middle,   // middle-tee GPS is the tee reference
      green: holeData.front,    // front-of-green GPS is closest to pin
    };

    const next = progressionReducer(
      stateRef.current,
      { lat: location.lat, lng: location.lng },
      coords,
      location.ts,
    );

    // Only update ref + act when state actually changed
    if (next === stateRef.current) return;
    stateRef.current = next;

    if (next.phase === 'completed' && !advTimerRef.current) {
      advTimerRef.current = setTimeout(() => {
        advTimerRef.current = null;
        advance();
      }, ADVANCE_DELAY_MS);
    }

    // If state reverted before timer fires, cancel auto-advance
    if (next.phase !== 'completed' && advTimerRef.current) {
      clearTimeout(advTimerRef.current);
      advTimerRef.current = null;
    }
  }, [location, isRoundActive, currentHole, courseData, advance, stale]);

  // Cleanup on unmount
  useEffect(() => () => {
    if (advTimerRef.current) clearTimeout(advTimerRef.current);
  }, []);
}
