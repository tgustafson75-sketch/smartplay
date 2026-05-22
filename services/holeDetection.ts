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
import { ownerSentinel } from './ownerSentinel';

// ─── Tunables ─────────────────────────────────────────────────────────

const POSITION_HISTORY_WINDOW_MS = 30_000;       // rolling 30s
const SUSTAINED_TRANSITION_MS    = 10_000;        // 10s sustained position required
// 2026-05-22 — Fix L. Bumped from 30 → 60. The 30y gate let cart-path
// motion trigger premature transitions: harness reproduced 3× on a single
// 18-hole cart round at Menifee Palms (H12→H13 at 114y/166y, H14→H15
// at 16y/49y!, H16→H17 at 76y/102y). 60y means "anywhere meaningfully
// near the green" disqualifies a transition. Real greens are 18-30y
// deep; 60y from centroid keeps the player on the current hole through
// approach + green-side play + first putt walk-up. Pair with
// TRANSITION_MARGIN_YD below — both gates must fail before a transition
// candidate even gets considered.
const MIN_DISTANCE_FROM_GREEN_YD = 60;
// 2026-05-22 — Fix L. New constant. The OLD comparison was
// `bestNextDist < distFromCurrentGreen` — fires the instant the next tee
// is even 1y closer. That's the H14→H15 disaster pattern: 16y from H15
// tee vs 49y from H14 green = transition fires while player is still
// putting. Require next tee to be at least TRANSITION_MARGIN_YD CLOSER
// than current green, i.e. the player has clearly committed to moving on,
// not just standing in a spot that happens to be marginally closer to
// the next tee than the green centroid.
const TRANSITION_MARGIN_YD       = 30;
// 2026-05-22 — Fix L. Cart-mode bonus. Cart paths inherently swing wide
// of the fairway centerline and can pass closer to adjacent holes' tees
// than a walker would. When settingsStore.cartMode is on we add this to
// BOTH the green-proximity gate AND the transition margin — i.e. cart
// players need to be even more clearly committed before auto-transition
// fires. Reading settingsStore via dynamic require to avoid the
// services/store circular import.
const CART_MODE_BONUS_YD         = 20;
const MAX_TRANSITION_LOOKAHEAD   = 2;             // only consider current+1 and current+2 holes
const POLL_INTERVAL_MS           = 4_000;         // 4s poll cadence (cheap)

function getCartMode(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const settingsMod = require('../store/settingsStore') as typeof import('../store/settingsStore');
    return settingsMod.useSettingsStore.getState().cartMode === true;
  } catch { return false; }
}

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
      ownerSentinel('holeDetection.markBus', e);
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
  // 2026-05-17 — Reset all module-level bookkeeping so round N+1
  // doesn't inherit candidateHole / lastTransitionAt / manualOverrideAt
  // from round N. The 20s manual-override window and the
  // transition-debounce window were both bleeding across rounds.
  lastTransitionAt = 0;
  manualOverrideAt = 0;
  candidateHole = null;
  candidateSince = 0;
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

  // 2026-05-22 — Fix L. Effective gates pick up the CART_MODE_BONUS_YD
  // when settings.cartMode is on. Carts ride paths offset from the
  // fairway centerline that can pass close to adjacent tees — apply a
  // wider buffer so a routine cart-path arc doesn't yank the player
  // into the next hole.
  const cartBonus = getCartMode() ? CART_MODE_BONUS_YD : 0;
  const effectiveMinFromGreen = MIN_DISTANCE_FROM_GREEN_YD + cartBonus;
  const effectiveMargin = TRANSITION_MARGIN_YD + cartBonus;

  // Must be at least effectiveMinFromGreen from current green to consider
  // a transition — short of that, the user is around the current green.
  if (distFromCurrentGreen < effectiveMinFromGreen) {
    return {
      hole_number: currentHole, confidence: 'high', transition_recommended: false,
      reason: `near current green (${Math.round(distFromCurrentGreen)}y of ${effectiveMinFromGreen}y gate${cartBonus ? ', cart-mode' : ''})`,
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

  // 2026-05-22 — Fix L. Was `bestNextDist < distFromCurrentGreen` — fired
  // the instant the next tee was even 1y closer than the current green.
  // That's the harness's H14→H15 failure mode (16y from H15 tee, 49y
  // from H14 green → transition fires while putting). Now require the
  // next tee to be at least effectiveMargin CLOSER than the current
  // green. Player has to be clearly committed to moving on.
  if (bestNextHole !== currentHole && distFromCurrentGreen - bestNextDist >= effectiveMargin) {
    return {
      hole_number: bestNextHole,
      confidence: bestNextDist < distFromCurrentGreen * 0.5 ? 'high' : 'medium',
      transition_recommended: true,
      reason: `closer to hole ${bestNextHole} tee (${Math.round(bestNextDist)}y) by ${Math.round(distFromCurrentGreen - bestNextDist)}y than hole ${currentHole} green (${Math.round(distFromCurrentGreen)}y), margin ${effectiveMargin}y`,
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
    // 2026-05-19 — Mirror hole transitions into the harness event log
    // so Tim can see (in the GPS Test Bench) exactly when and why each
    // hole advance fired. Lazy require dodges any circular import risk.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { logHarnessEvent } = require('./simulatedGPS');
      logHarnessEvent('transition', `→ hole ${next} · ${result.reason}`);
    } catch {}
    listeners.forEach(l => {
      try { l(next, result.reason); } catch (e) { ownerSentinel('holeDetection.listener', e); }
    });
  }
}
