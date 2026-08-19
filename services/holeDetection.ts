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
// 2026-06-07 (audit N2) — gpsManager's fix carries `speed` (smartFinder's
// LastFix does not), used for the cart-speed gate below.
import { getLastFix as getGpsManagerFix } from './gpsManager';
import { haversineYards } from '../utils/geoDistance';
import { isValidGolfCoord } from '../utils/coordGuard';
import { ownerSentinel } from './ownerSentinel';

// ─── Tunables ─────────────────────────────────────────────────────────
//
const POSITION_HISTORY_WINDOW_MS = 30_000;       // rolling 30s
const SUSTAINED_TRANSITION_MS    = 10_000;        // 10s sustained position required
const MIN_DISTANCE_FROM_GREEN_YD = 30;            // user must be 30+ yds from current green
const MAX_TRANSITION_LOOKAHEAD   = 2;             // only consider current+1 and current+2 holes
// 2026-08-08 (Tim-approved market model) — an UNSCORED hole may still advance, but only when the player
// is genuinely AT the next tee (tight radius), not merely closer-to-it (the loose rule stays score-gated
// so the Dudley Hills premature jump can't return). 25y ≈ standing on the tee box.
const AT_NEXT_TEE_CONFIRM_YD     = 25;
// 2026-08-19 — how close the next tee has to be for "near the next tee" to be a true statement.
// Generous enough to cover the whole walk from a green to the following tee; small enough that it
// can no longer shadow the loop-back safeguard from the far side of the course.
const NEAR_NEXT_TEE_YD           = 100;
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
 *
 * 2026-05-22 — Fix T hardening (after two real Menifee rounds where the
 * auto-advance STILL fired despite the _layout.tsx subscriber gate).
 * Polling itself now gates on settings.autoHoleAdvance — when the user
 * has manual hole control (DEFAULT), this function returns early without
 * starting the interval. Zero ticks means zero emissions means zero
 * chance of leakage through any subscriber path we haven't audited.
 * Subscribers can re-arm later by toggling Settings → Auto Hole Advance.
 */
export function startHoleDetection(): void {
  if (pollTimer) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const settingsMod = require('../store/settingsStore') as typeof import('../store/settingsStore');
    if (!settingsMod.useSettingsStore.getState().autoHoleAdvance) {
      console.log('[holeDetection] start skipped — autoHoleAdvance is OFF (manual hole control)');
      return;
    }
  } catch { /* defensive — if settings fail to load, fall through to start */ }
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

  // 2026-06-01 — Fix GL: validate player position before any haversine.
  // Defense in depth — gpsManager.processFix should already guarantee
  // valid lastFix coords, but holeDetection's reads can race a fresh
  // round-start where lastFix is briefly null/stale.
  if (!isValidGolfCoord(position.lat, position.lng)) {
    return { hole_number: currentHole, confidence: 'low', transition_recommended: false, reason: 'invalid player coord' };
  }

  const currentGeom = getHoleGeometry(courseId, currentHole);
  // 2026-06-01 — Fix GL: also validate the cached green coord. Cache
  // entries can have placeholder/garbage values from a partial API
  // response. Without this guard, haversine against {0,0} returns
  // ~10M yards, fails the >gate check trivially, and the player is
  // pinned to currentHole forever (or worse, the next-hole gate
  // succeeds against the same garbage and flips a wrong transition).
  if (!currentGeom?.green || !isValidGolfCoord(currentGeom.green.lat, currentGeom.green.lng)) {
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
  // 2026-08-08 (wave-2 audit #3) — bound candidates by the ROUND's real last hole, not a hardcoded 18.
  // The twice-around geometry wrap made getHoleGeometry(courseId, 10) REAL at a 9-hole course, so a
  // SINGLE-loop nine finishing near the 1st tee started emitting phantom hole-10 transitions (clamped
  // back by setCurrentHole, but re-toasting the unscored nag every override window).
  let roundMaxHole = 18;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const rs = require('../store/roundStore') as typeof import('../store/roundStore');
    roundMaxHole = rs.roundLastHole(rs.useRoundStore.getState());
  } catch { /* store unavailable (tests) — keep 18 */ }
  for (let offset = 1; offset <= MAX_TRANSITION_LOOKAHEAD; offset++) {
    const candidate = currentHole + offset;
    if (candidate > roundMaxHole) break;
    if (scoresByHole[candidate] != null) continue; // already played
    const candGeom = getHoleGeometry(courseId, candidate);
    const candTee = candGeom?.tee;
    // 2026-06-01 — Fix GL: guard candidate tee coord. Garbage tee
    // coord on hole N+1 would otherwise make the next-tee gate fire
    // trivially (distance to {0,0} is huge so a forward gate that
    // measures "closer than current green" would still always fail —
    // but the inverse is also true: a near-zero tee would always be
    // "closer" than the current green if the player is far from
    // origin, triggering spurious forward transitions).
    if (!candTee || !isValidGolfCoord(candTee.lat, candTee.lng)) continue;
    const d = haversineYards(position, candTee);
    if (d < bestNextDist) {
      bestNextDist = d;
      bestNextHole = candidate;
    }
  }

  // 2026-07-03 (Tim — Dudley Hills) — do NOT advance FORWARD off an UNSCORED hole.
  // The next hole's tee is often within a few paces of the current green, so walking
  // off the green toward it would jump the hole BEFORE the player finished putting +
  // logging the score (Tim: "it'd give me hole 3's yardage while I'm still on 2").
  // Hole advance is SCORE-driven — logScore auto-advances on the first score, and GPS
  // only confirms a FORWARD transition once the current hole actually has a score.
  // (The backward loop-back / re-entry check below is unaffected — it returns to an
  // already-played hole. Manual + voice hole selection also bypass this via
  // setCurrentHole.)
  const currentHoleScored = (scoresByHole[currentHole] ?? 0) > 0;
  if (bestNextHole !== currentHole && bestNextDist < distFromCurrentGreen && currentHoleScored) {
    return {
      hole_number: bestNextHole,
      confidence: bestNextDist < distFromCurrentGreen * 0.5 ? 'high' : 'medium',
      transition_recommended: true,
      reason: `closer to hole ${bestNextHole} tee (${Math.round(bestNextDist)}y) than hole ${currentHole} green (${Math.round(distFromCurrentGreen)}y)`,
    };
  }
  // 2026-08-08 (Tim-approved MARKET MODEL — "GPS advances, score nags"). An unscored hole no longer
  // blocks the advance forever (walking to the next tee without logging used to leave EVERY system —
  // yardage, shot stamping, watch push, tee brief — stale on the old hole with zero feedback). It now
  // advances when the player is GENUINELY AT the next tee (≤25y — standing on the box), which the
  // ≥30y-from-green gate above keeps distinct from "still putting near a close-by tee" (the Dudley
  // premature-jump case). The looser closer-than rule stays score-gated. The transition consumer
  // surfaces the "hole N not scored" nag; the scorecard's any-hole chips take the late score.
  if (bestNextHole !== currentHole && !currentHoleScored && bestNextDist <= AT_NEXT_TEE_CONFIRM_YD) {
    return {
      hole_number: bestNextHole,
      confidence: 'high',
      transition_recommended: true,
      reason: `AT hole ${bestNextHole} tee (${Math.round(bestNextDist)}y) with hole ${currentHole} unscored — market-model advance (score nag to follow)`,
    };
  }
  /**
   * 2026-08-19 (course-engine sweep) — this branch means "you are NEAR the next tee but haven't
   * scored yet", and it had no idea what near meant. Its only test was `bestNextDist <
   * distFromCurrentGreen`, which on a long hole is satisfied from anywhere on the property: the sweep
   * caught it reporting `near hole 11 tee` from ELEVEN HUNDRED YARDS away, purely because that tee
   * happened to be marginally closer than the green being walked to.
   *
   * It returns transition_recommended:false, so it never moved anyone — but it RETURNS, and
   * everything below it is therefore skipped. The thing below it is the loop-back safeguard. So a
   * player who walked back to a hole they had already played could be standing on that tee and be
   * told, in effect, "stay where you are, you're near the next tee" — the one case the safeguard
   * exists to catch, shadowed by a branch that had wandered outside its own meaning.
   *
   * Bounded to a distance at which "near" is true. The Dudley premature-jump protection this branch
   * was written for is entirely within that radius (it is about a tee a few paces off the green), so
   * that behaviour is unchanged; only the far-field case falls through to the checks it was hiding.
   */
  if (bestNextHole !== currentHole && bestNextDist < distFromCurrentGreen
      && bestNextDist <= NEAR_NEXT_TEE_YD && !currentHoleScored) {
    return {
      hole_number: currentHole, confidence: 'high', transition_recommended: false,
      reason: `near hole ${bestNextHole} tee but hole ${currentHole} not yet scored — advances when you're ON the tee (≤${AT_NEXT_TEE_CONFIRM_YD}y)`,
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
    // 2026-08-08 (progression audit P0-3 — score-vs-GPS ping-pong at shared tee complexes). If the
    // player is ALSO within ~30y of the CURRENT hole's tee (co-located tees: waiting to hit on N+1
    // beside N's tee box), a <20y read on the played tee is ambiguous — do NOT jump backward. Genuine
    // walk-backs (retrieving a club mid-fairway of the old hole) are nowhere near the current tee.
    const currentTee = currentGeom.tee;
    const nearOwnTee = !!currentTee && isValidGolfCoord(currentTee.lat, currentTee.lng)
      && haversineYards(position, currentTee) <= 30;
    for (const playedHoleStr of Object.keys(scoresByHole)) {
      const playedHole = Number(playedHoleStr);
      if (!Number.isFinite(playedHole) || playedHole === currentHole) continue;
      if (nearOwnTee) break; // at our own tee box — never re-enter a played hole from here
      const playedGeom = getHoleGeometry(courseId, playedHole);
      const playedTee = playedGeom?.tee;
      // 2026-06-01 — Fix GL: guard played-hole tee coord.
      if (!playedTee || !isValidGolfCoord(playedTee.lat, playedTee.lng)) continue;
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

  // GPS quality freeze: if signal is weak/none/stale, skip detection
  // entirely. 2026-05-27 — Fix EY: pass fix.timestamp so the new
  // 'stale' classification from Fix ET actually triggers here.
  // Without the timestamp, a 30s-old fix was reported by stored
  // accuracy alone and could fire a hole transition off cached
  // coordinates (e.g., player sits idle on tee, phone deep-sleeps,
  // cached fix is 60s old, app resumes and immediately transitions
  // hole based on stale coords).
  const quality = classifyAccuracy(fix.accuracy_m, fix.timestamp);
  if (quality.level === 'weak' || quality.level === 'none' || quality.level === 'stale') {
    candidateHole = null;
    candidateSince = 0;
    return;
  }

  // 2026-06-07 (audit N2) — cart-speed gate. Don't auto-advance while
  // moving at cart speed: a player driving PAST the next tee could
  // otherwise trip a premature transition. Walking (< ~2.7 m/s ≈ 6 mph)
  // is fine; null speed (common on stationary Android fixes) is treated
  // as not-moving → allowed. Only affects opt-in Auto Hole Advance.
  const MAX_WALK_SPEED_MS = 2.7;
  const gpsSpeed = getGpsManagerFix()?.speed ?? null;
  if (typeof gpsSpeed === 'number' && gpsSpeed > MAX_WALK_SPEED_MS) {
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
