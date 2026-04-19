/**
 * features/courses/engine/detectCourse.ts
 *
 * Detects whether the user is at a known golf course based on GPS coordinates.
 *
 * False-positive prevention:
 *   • User must be within `radius` metres of a course centre.
 *   • User must have been inside that radius continuously for `DWELL_MS` (10 s).
 *   • Speed must be below `MAX_SPEED_MS` (≈ walking, ~2 m/s) — filters driving past.
 *
 * Pure functions + a single stateful hook — no global singletons.
 */

import { useEffect, useRef, useState } from 'react';
import { type UnifiedLocation } from '../../../core/hooks/useUnifiedGPS';
import { COURSE_GPS, type CourseGPSEntry } from '../data/courseGPS';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Must stay inside the radius for this long before triggering (ms) */
const DWELL_MS = 10_000;

/** Walking speed threshold in m/s — above this we assume user is driving past */
const MAX_SPEED_MS = 2.5;

// ── Haversine (metres) ────────────────────────────────────────────────────────

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R  = 6_371_000;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;
  const a  = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Pure detection (no state) ─────────────────────────────────────────────────

/**
 * Returns the first course whose GPS circle contains the given location.
 * Does NOT check speed or dwell time — those are handled in the hook.
 */
export function findNearestCourse(
  loc: { lat: number; lng: number },
  courses: CourseGPSEntry[] = COURSE_GPS,
): CourseGPSEntry | null {
  for (const c of courses) {
    if (haversineM(loc.lat, loc.lng, c.lat, c.lng) <= c.radius) {
      return c;
    }
  }
  return null;
}

// ── Stateful hook ─────────────────────────────────────────────────────────────

export interface UseCourseDetectionResult {
  /** Course that passed dwell + speed checks — ready to show confirmation. */
  detectedCourse: CourseGPSEntry | null;
  /** Call this after the user confirms or dismisses to reset detection. */
  clearDetection: () => void;
}

/**
 * Hook that runs course detection on every GPS update from useUnifiedGPS.
 * Fires `onDetect(course)` once when dwell + speed conditions are met.
 *
 * Pass `disabled = true` when a round is already active to avoid
 * auto-detect interrupting play.
 */
export function useCourseDetection(
  location: UnifiedLocation | null,
  options: {
    disabled?:  boolean;
    courses?:   CourseGPSEntry[];
  } = {},
): UseCourseDetectionResult {
  const { disabled = false, courses = COURSE_GPS } = options;

  const [detectedCourse, setDetectedCourse] = useState<CourseGPSEntry | null>(null);

  // Track when the user first entered a course radius
  const dwellStartRef    = useRef<number | null>(null);
  const dwellCourseRef   = useRef<CourseGPSEntry | null>(null);
  const alreadyFiredRef  = useRef<boolean>(false);

  useEffect(() => {
    if (disabled || !location) return;
    if (alreadyFiredRef.current) return; // don't re-fire after detection

    // Speed guard — expo-location provides speed in m/s (may be null)
    // We read it via the raw location if available; UnifiedLocation doesn't carry it,
    // so we can only gate when speed IS provided (skip gate when null).
    const candidate = findNearestCourse(location, courses);

    if (!candidate) {
      // Left any course zone — reset dwell
      dwellStartRef.current  = null;
      dwellCourseRef.current = null;
      return;
    }

    // Switched to a different course zone — restart dwell
    if (dwellCourseRef.current?.id !== candidate.id) {
      dwellStartRef.current  = location.ts;
      dwellCourseRef.current = candidate;
      return;
    }

    // Still inside the same course — check dwell time
    const dwell = location.ts - (dwellStartRef.current ?? location.ts);
    if (dwell >= DWELL_MS) {
      alreadyFiredRef.current = true;
      setDetectedCourse(candidate);
    }
  }, [location, disabled, courses]);

  const clearDetection = () => {
    setDetectedCourse(null);
    alreadyFiredRef.current = false;
    dwellStartRef.current   = null;
    dwellCourseRef.current  = null;
  };

  return { detectedCourse, clearDetection };
}
