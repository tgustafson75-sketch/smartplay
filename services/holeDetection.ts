/**
 * Phase Q.5b — Automatic hole detection with sustained-position logic.
 *
 * Replaces the prior inline transition logic in roundStore.setCurrentHole
 * with a hardened service that resists common GPS failure modes:
 *
 *   • Sustained-position threshold (10s) prevents jitter or proximity
 *     fly-bys from triggering false transitions
 *   • 30-yard separation from current green required (so users wandering
 *     in green-side rough don't bounce to the next hole)
 *   • GPS-quality freeze (no transitions during weak/none signal)
 *   • Sequence-aware (won't transition backward to already-played holes,
 *     handles dogleg + loop-back layouts where adjacent-hole proximity
 *     is misleading)
 *
 * Manual override is preserved: `useRoundStore.setCurrentHole()` remains
 * the public API for user-driven hole selection (SmartFinder hole-jump
 * picker, voice "Kevin I'm on hole 14"). This service only fires
 * automatic transitions; it never overrides a manual selection.
 *
 * Architecture: event-bus pattern. Consumers (roundStore via _layout.tsx)
 * subscribe to `subscribeToHoleDetection`; the service emits transitions
 * when sustained-position logic fires. Decouples GPS sensing from store
 * mutation.
 */

import { useRoundStore } from '../store/roundStore';
import { fetchCourseGeometry, getHoleGeometry } from './courseGeometryService';
import { getLastFix, classifyAccuracy } from './smartFinderService';
import { haversineYards } from '../utils/geoDistance';

// ─── Tunables ─────────────────────────────────────────────────────────

const POSITION_HISTORY_WINDOW_MS = 30_000;       // rolling 30s
const SUSTAINED_TRANSITION_MS    = 10_000;        // 10s sustained position required
const MIN_DISTANCE_FROM_GREEN_YD = 30;            // user must be 30+ yds from current green
const MAX_TRANSITION_LOOKAHEAD   = 2;             // only consider current+1 and current+2 holes
const POLL_INTERVAL_MS           = 4_000;         // 4s poll cadence (cheap)

type LatLng = { lat: number; lng: number };

interface PositionSample {
  loc: LatLng;
  ts: number;
}

interface DetectionResult {
  hole_number: number;
  confidence: 'high' | 'medium' | 'low';
  transition_recommended: boolean;
  reason: string;
}

type Listener = (next_hole: number, reason: string) => void;

const listeners = new Set<Listener>();
const positionHistory: PositionSample[] = [];

let pollTimer: ReturnType<typeof setInterval> | null = null;
let lastTransitionAt = 0;
let manualOverrideAt = 0;

// ─── Public API ──────────────────────────────────────────────────────

/** Subscribe to automatic hole-transition events. */
export function subscribeToHoleDetection(cb: Listener): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** Mark a manual override so automatic detection respects it for a window. */
export function noteManualOverride(): void {
  manualOverrideAt = Date.now();
  // Clear position history so the next sustained-position window starts
  // from the new hole context, not the old one.
  positionHistory.length = 0;
}

/**
 * Start the polling loop. Idempotent. No-op when no round is active or when
 * the round store reports we're not on a course.
 */
export function startHoleDetection(): void {
  if (pollTimer) return;
  pollTimer = setInterval(() => { void tick(); }, POLL_INTERVAL_MS);
  // Phase BG — subscribe to position-mark bus so Mark events fire an
  // immediate tick. Previous behavior waited for the next poll cycle
  // (up to POLL_INTERVAL_MS), which made Mark feel non-responsive for
  // hole transitions. The bus subscription closes the gap.
  if (!markUnsub) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { subscribeToMark } = require('./positionMarkBus');
      markUnsub = subscribeToMark(() => {
        console.log('[audit:gps] holeDetection tick triggered by mark event');
        void tick();
      });
    } catch (e) {
      console.log('[holeDetection] mark bus subscribe failed:', e);
    }
  }
  // Fire one immediate tick so we don't wait the first interval.
  void tick();
}

/** Stop the polling loop. Called when round ends. */
export function stopHoleDetection(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (markUnsub) {
    markUnsub();
    markUnsub = null;
  }
  positionHistory.length = 0;
}

let markUnsub: (() => void) | null = null;

/**
 * Pure-function detector exposed for tests + the simulated GPS harness.
 * Caller supplies the GPS position; this returns a recommendation without
 * side effects.
 */
export function detectCurrentHole(
  position: LatLng,
  courseId: string | null,
  currentHole: number,
  scoresByHole: Record<number, number>,
): DetectionResult {
  if (!courseId) {
    return { hole_number: currentHole, confidence: 'low', transition_recommended: false, reason: 'no course id' };
  }

  const currentGeom = getHoleGeometry(courseId, currentHole);
  if (!currentGeom?.green) {
    return { hole_number: currentHole, confidence: 'low', transition_recommended: false, reason: 'no current-hole green geometry' };
  }

  const distFromCurrentGreen = haversineYards(position, currentGeom.green);

  // Must be at least MIN_DISTANCE_FROM_GREEN_YD from current green to consider
  // a transition — short of that, the user is around the current green.
  if (distFromCurrentGreen < MIN_DISTANCE_FROM_GREEN_YD) {
    return {
      hole_number: currentHole, confidence: 'high', transition_recommended: false,
      reason: `near current green (${Math.round(distFromCurrentGreen)}y)`,
    };
  }

  // Sequence-aware: only consider the next 1-2 holes. Skip holes already
  // played (dogleg / loop-back protection — won't transition backward).
  let bestNextHole = currentHole;
  let bestNextDist = Infinity;
  for (let offset = 1; offset <= MAX_TRANSITION_LOOKAHEAD; offset++) {
    const candidate = currentHole + offset;
    if (candidate > 18) break;
    if (scoresByHole[candidate] != null) continue; // already played
    const candGeom = getHoleGeometry(courseId, candidate);
    const candTee = candGeom?.tee;
    if (!candTee) continue;
    const d = haversineYards(position, candTee);
    if (d < bestNextDist) {
      bestNextDist = d;
      bestNextHole = candidate;
    }
  }

  // Closer to next tee than current green? Recommend transition.
  if (bestNextHole !== currentHole && bestNextDist < distFromCurrentGreen) {
    return {
      hole_number: bestNextHole,
      confidence: bestNextDist < distFromCurrentGreen * 0.5 ? 'high' : 'medium',
      transition_recommended: true,
      reason: `closer to hole ${bestNextHole} tee (${Math.round(bestNextDist)}y) than hole ${currentHole} green (${Math.round(distFromCurrentGreen)}y)`,
    };
  }

  // Phase 405 wave 2 — hole re-entry safeguard. The forward loop above
  // skips already-played holes, which is correct for normal play. But
  // when the player legitimately walks BACK to a previously-played
  // hole (forgot a club, retrieving a lost ball, replaying after a
  // restart, twosome catches up to a tied match), the forward
  // detector silently leaves currentHole pointing at the wrong hole.
  // The loop-back check: when the player is >50y from the current
  // hole's green AND <20y from a previously-played hole's tee, signal
  // a re-entry transition. The 20y inner-radius prevents drift; the
  // sequence-aware forward detector above still wins when the player
  // is genuinely advancing.
  if (distFromCurrentGreen > 50) {
    for (const playedHoleStr of Object.keys(scoresByHole)) {
      const playedHole = Number(playedHoleStr);
      if (!Number.isFinite(playedHole) || playedHole === currentHole) continue;
      const playedGeom = getHoleGeometry(courseId, playedHole);
      const playedTee = playedGeom?.tee;
      if (!playedTee) continue;
      const d = haversineYards(position, playedTee);
      if (d < 20) {
        return {
          hole_number: playedHole,
          confidence: 'medium',
          transition_recommended: true,
          reason: `re-entry to hole ${playedHole} (${Math.round(d)}y from tee, ${Math.round(distFromCurrentGreen)}y from hole ${currentHole} green)`,
        };
      }
    }
  }

  return {
    hole_number: currentHole, confidence: 'medium', transition_recommended: false,
    reason: `still closest to hole ${currentHole} green`,
  };
}

/**
 * Sustained-position check. Called by the polling loop after each new
 * GPS sample. Returns true when the sustained-position window has held
 * a transition recommendation for SUSTAINED_TRANSITION_MS continuously.
 */
export function handleSustainedPosition(
  candidateHole: number,
  windowStartMs: number,
): boolean {
  const now = Date.now();
  // Look back at the position history within the sustained-transition
  // window. If every sample within it agreed on candidateHole, fire.
  const recentSamples = positionHistory.filter(s => s.ts >= windowStartMs);
  if (recentSamples.length < 2) return false; // need at least 2 samples
  const elapsed = now - recentSamples[0].ts;
  return elapsed >= SUSTAINED_TRANSITION_MS;
}

// ─── Internal — polling tick ─────────────────────────────────────────

let candidateHole: number | null = null;
let candidateSince = 0;

async function tick(): Promise<void> {
  const round = useRoundStore.getState();
  if (!round.isRoundActive) return;

  const fix = getLastFix();
  if (!fix) return;

  // GPS quality freeze: if signal is weak/none, skip detection entirely
  const quality = classifyAccuracy(fix.accuracy_m);
  if (quality.level === 'weak' || quality.level === 'none') {
    candidateHole = null;
    candidateSince = 0;
    return;
  }

  // Manual override window: respect a recent user-driven hole change
  if (Date.now() - manualOverrideAt < SUSTAINED_TRANSITION_MS * 2) return;

  // Add position to rolling history
  const now = Date.now();
  positionHistory.push({ loc: fix.location, ts: now });
  while (positionHistory.length && positionHistory[0].ts < now - POSITION_HISTORY_WINDOW_MS) {
    positionHistory.shift();
  }

  // Warm geometry cache opportunistically
  if (round.activeCourseId) {
    void fetchCourseGeometry(round.activeCourseId).catch(() => {});
  }

  const result = detectCurrentHole(
    fix.location,
    round.activeCourseId,
    round.currentHole,
    round.scores,
  );

  if (!result.transition_recommended) {
    candidateHole = null;
    candidateSince = 0;
    return;
  }

  if (candidateHole !== result.hole_number) {
    candidateHole = result.hole_number;
    candidateSince = now;
    return;
  }

  // Sustained the same candidate long enough?
  if (handleSustainedPosition(candidateHole, candidateSince)) {
    if (now - lastTransitionAt < SUSTAINED_TRANSITION_MS) return; // debounce
    lastTransitionAt = now;
    const next = candidateHole;
    candidateHole = null;
    candidateSince = 0;
    console.log('[holeDetection] auto-transition:', next, '·', result.reason);
    listeners.forEach(l => {
      try { l(next, result.reason); } catch (e) { console.log('[holeDetection] listener err', e); }
    });
  }
}
