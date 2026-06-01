/**
 * Phase 405 wave 1 — Off-course detection.
 *
 * Polls during active rounds; when the player is more than
 * OFF_COURSE_THRESHOLD_YD from every hole's nearest reference point
 * (tee, middle, front, back) AND sustained for SUSTAINED_OFF_COURSE_MS,
 * sets isOffCourse=true. Returns to false the moment the player is
 * back within the threshold of any hole reference.
 *
 * Why this exists per the Phase 405 audit:
 *   Today when the player wanders off the property (into woods, retrieving
 *   a wayward ball, walking back to the clubhouse), SmartFinder yardages
 *   go silently blank and hole-detection freezes (it can't tell which
 *   hole to evaluate). The user has no UI signal — they just see the
 *   yardage row go to dashes and don't know why. This detector lights
 *   up an explicit "Off course" badge in the data strip + a clear voice
 *   path back ("Tap Mark when you're at the hole you're playing").
 *
 * Architecture: thin Zustand store + setInterval poller. Started by
 * the round-lifecycle (when roundStore.isRoundActive becomes true) and
 * stopped on round end. Subscribes implicitly via roundStore +
 * smartFinderService.getLastFix(). No standalone Location subscription.
 */

import { create } from 'zustand';
import { useRoundStore } from '../store/roundStore';
import { getLastFix } from './smartFinderService';
import { haversineYards } from '../utils/geoDistance';
// 2026-06-01 — Fix GF.1: geometryCache fallback. When roundStore.courseHoles
// is sparse (golfcourseapi-only courses, no bundled COURSES entry — common
// for non-Palms/Lakes/Crystal rounds), this detector was silent because
// it iterated roundStore.courseHoles only. The geometry cache populated
// asynchronously by services/courseGeometryService (via the Fix FZ
// background fetch in runStartRound) DID have the hole references, but
// offCourseDetector never read it. Now: if courseHoles yields no usable
// candidates, walk the cached geometry as a second source.
import { getCachedGeometry } from './courseGeometryService';

// Off-course threshold: 400 yards beyond any hole reference point.
// 2026-05-25 — Fix U: relaxed from 200y → 400y. Tim's Palms round
// flipped off-course mid-play because parallel-hole layouts plus cart
// paths between holes regularly put the player 200-300y from the
// CURRENT hole's nearest reference even when they're firmly on the
// property. 400y still catches "I'm in the parking lot / driving
// range / wrong course" cases, paired with the 20s SUSTAINED gate.
const OFF_COURSE_THRESHOLD_YD = 400;
// Sustained-off-course window. Must be >15s so retrieving a wayward
// ball doesn't bounce the indicator. Less than the hole-transition
// 30s so the user sees the badge before false transitions could fire.
const SUSTAINED_OFF_COURSE_MS = 20_000;
// Poll cadence — cheap because we're piggybacking on existing GPS.
const POLL_INTERVAL_MS = 5_000;

interface OffCourseState {
  isOffCourse: boolean;
  /** Approximate yards to the nearest hole reference point. Null when
   *  the detector has no current fix. Surfaced in the badge so the
   *  user knows how far they are from the course geometry. */
  yardsToNearestHole: number | null;
  /** Timestamp the detector first observed the off-course condition.
   *  Used internally to enforce the sustained-window threshold. */
  candidateSinceTs: number | null;
  setOffCourse: (off: boolean, yards: number | null) => void;
  reset: () => void;
}

export const useOffCourseStore = create<OffCourseState>((set) => ({
  isOffCourse: false,
  yardsToNearestHole: null,
  candidateSinceTs: null,
  setOffCourse: (off, yards) => set({
    isOffCourse: off,
    yardsToNearestHole: yards,
    // Reset the sustain timer when state changes
    candidateSinceTs: off ? Date.now() : null,
  }),
  reset: () => set({ isOffCourse: false, yardsToNearestHole: null, candidateSinceTs: null }),
}));

let pollTimer: ReturnType<typeof setInterval> | null = null;

function tick(): void {
  const round = useRoundStore.getState();
  if (!round.isRoundActive) {
    // Clear any leftover state when the round ends.
    if (useOffCourseStore.getState().isOffCourse) {
      useOffCourseStore.getState().reset();
    }
    return;
  }

  const fix = getLastFix();
  if (!fix || !fix.location) return;
  const player = fix.location;

  // Walk every hole's reference points and find the minimum distance.
  // courseHoles may include tee, middle, front, back coords; we use
  // the smallest of those per hole.
  let nearest = Infinity;
  for (const h of round.courseHoles) {
    const candidates = [
      h.middleLat && h.middleLng ? { lat: h.middleLat, lng: h.middleLng } : null,
      h.frontLat && h.frontLng ? { lat: h.frontLat, lng: h.frontLng } : null,
      h.backLat && h.backLng ? { lat: h.backLat, lng: h.backLng } : null,
      h.teeLat && h.teeLng ? { lat: h.teeLat, lng: h.teeLng } : null,
    ].filter((c): c is { lat: number; lng: number } => c != null);
    for (const c of candidates) {
      const d = haversineYards(player, c);
      if (d < nearest) nearest = d;
    }
  }

  // 2026-06-01 — Fix GF.1: when courseHoles yielded no candidates
  // (Number.isFinite(nearest) === false), fall back to the geometry
  // cache populated async by courseGeometryService. Same shape as
  // smartFinderService's 4-tier cascade — cache-as-secondary-source.
  // Without this, the detector was silent for the entire round on any
  // course where geometry arrived via the async cache rather than
  // being baked into roundStore.courseHoles at round-start.
  if (!Number.isFinite(nearest) && round.activeCourseId) {
    const cached = getCachedGeometry(round.activeCourseId);
    if (cached) {
      for (const h of cached.holes) {
        const candidates = [
          h.green,
          h.green_front,
          h.green_back,
          h.tee,
        ].filter((c): c is { lat: number; lng: number } => c != null);
        for (const c of candidates) {
          const d = haversineYards(player, c);
          if (d < nearest) nearest = d;
        }
      }
    }
  }

  if (!Number.isFinite(nearest)) {
    // No usable course geometry (neither courseHoles nor cache) — treat
    // as not-off-course rather than misleading the user. Same
    // "honest unknown" stance Fix FZ established at runStartRound.
    return;
  }

  const store = useOffCourseStore.getState();
  const isFar = nearest > OFF_COURSE_THRESHOLD_YD;

  // 2026-05-19 — Lazy-require the harness event logger so off-course
  // flips show up in the GPS Test Bench timeline alongside transitions
  // and score logs.
  const logEvent = (kind: string, detail: string) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { logHarnessEvent } = require('./simulatedGPS');
      logHarnessEvent(kind, detail);
    } catch {}
  };

  if (isFar) {
    if (!store.isOffCourse) {
      // Newly far. Enforce sustained-window before flipping the badge.
      if (store.candidateSinceTs == null) {
        useOffCourseStore.setState({ candidateSinceTs: Date.now(), yardsToNearestHole: Math.round(nearest) });
      } else if (Date.now() - store.candidateSinceTs >= SUSTAINED_OFF_COURSE_MS) {
        store.setOffCourse(true, Math.round(nearest));
        logEvent('off_course', `flipped TRUE · ${Math.round(nearest)}y from nearest hole point`);
      } else {
        // Still observing — just update the distance.
        useOffCourseStore.setState({ yardsToNearestHole: Math.round(nearest) });
      }
    } else {
      // Already off-course — keep the live yardage updated.
      useOffCourseStore.setState({ yardsToNearestHole: Math.round(nearest) });
    }
  } else {
    // Within threshold — clear any candidate window AND the badge.
    if (store.isOffCourse) {
      store.setOffCourse(false, Math.round(nearest));
      logEvent('off_course', `cleared (back within threshold · ${Math.round(nearest)}y)`);
    } else if (store.candidateSinceTs != null) {
      useOffCourseStore.setState({ candidateSinceTs: null, yardsToNearestHole: Math.round(nearest) });
    }
  }
}

export function startOffCourseDetector(): void {
  if (pollTimer) return;
  pollTimer = setInterval(tick, POLL_INTERVAL_MS);
  console.log('[offCourse] detector started');
}

export function stopOffCourseDetector(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  useOffCourseStore.getState().reset();
  console.log('[offCourse] detector stopped');
}
