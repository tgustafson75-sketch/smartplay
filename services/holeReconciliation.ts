/**
 * 2026-05-22 — Hole Reconciliation Service.
 *
 * USER-INITIATED hole correction. Distinct from `services/holeDetection.ts`
 * (which handles BACKGROUND auto-advance and is currently dormant by
 * default per Fix T's `settings.autoHoleAdvance`). This service handles
 * the "I tapped Refresh GPS, figure out where I really am" flow.
 *
 * The split is deliberate: auto-detection has to be conservative (Fix L's
 * 60yd green buffer + 30yd transition margin + cart-mode bonus) to keep
 * a slow walk past the green from yanking the player into the next hole.
 * Manual reconciliation runs at the user's request — they're explicitly
 * asking "where am I?" — so it can be more aggressive about snapping to
 * the right hole.
 *
 * Both still respect three hard safety rules:
 *   1. Never transition backward to a hole the player already started.
 *   2. Refuse to change holes when GPS accuracy is unreliable (>30m).
 *   3. Apply a "current hole bias" — the existing hole has to be
 *      substantially worse before we swap, even on force. Player taps
 *      Refresh expecting clarity, not whiplash.
 *
 * Golf rationale for the constants (see usage below):
 *   - GREEN_ACTIVE_RADIUS_YD (60): centered on a green you're likely on
 *     that hole through approach, putting, and short-game cleanup.
 *   - TEE_ACTIVE_RADIUS_YD (40): centered on a tee you're queueing up
 *     for that hole; cart-path tees on co-located courses can be tight
 *     so the radius stays narrower than green's.
 *   - ACCURACY_WARN_THRESHOLD_M (30): below this we trust the fix; at
 *     >30m horizontal accuracy you can be off by a fairway-width, so
 *     refusing to act is safer than guessing.
 */

import { getHoleGeometry } from './courseGeometryService';
import { haversineYards } from '../utils/geoDistance';
import { useRoundStore } from '../store/roundStore';
import type { GpsFix } from './gpsManager';
import { devLog } from './devLog';
// 2026-05-22 — Course Data Orchestrator: read the sustained-heading
// signal to break ties between parallel / dogleg holes (the hardest
// case for proximity-only scoring).
import { getSustainedHeading } from './courseDataOrchestrator';

// ─── Tunables ────────────────────────────────────────────────────────────

/** Auto-mode (non-force): existing hole must be at least this much worse
 *  in proximity-score before we swap. Larger than the holeDetection.ts
 *  TRANSITION_MARGIN_YD (30) by +25y because manual-refresh users expect
 *  the existing hole to "win" unless something is clearly off. */
const RECONCILE_MARGIN_NON_FORCE_YD = 55;

/** Force-mode (user tapped Refresh): tighter margin so we DO snap when
 *  the player is clearly on a different hole than the app thinks. Same
 *  as holeDetection.ts's TRANSITION_MARGIN_YD. */
const RECONCILE_MARGIN_FORCE_YD = 30;

/** Refuse to act on a fix this inaccurate — surface a warning instead.
 *  30m is roughly a fairway width; closer than that we trust the fix. */
const ACCURACY_WARN_THRESHOLD_M = 30;

/** Proximity-zone tunables used by the scoring helper. See file header
 *  comment for golf rationale. */
const GREEN_ACTIVE_RADIUS_YD = 60;
const TEE_ACTIVE_RADIUS_YD = 40;

/** 2026-05-22 — Heading-alignment tunables. When the player's sustained
 *  movement heading aligns with a hole's tee→green axis (within
 *  HEADING_ALIGN_TOL_DEG), that hole gets a proximity bonus equal to
 *  HEADING_BONUS_YD subtracted from its score. Aimed at the doubly-tricky
 *  parallel-hole / dogleg case where two holes' centroids are close in
 *  yardage but the player is clearly moving ALONG one of them.
 *
 *  20° tolerance covers a mid-fairway position with normal walking
 *  meander; 25y bonus is calibrated so it nudges a tied hole into the
 *  lead but can't override a clear 30y proximity gap. */
const HEADING_ALIGN_TOL_DEG = 20;
const HEADING_BONUS_YD = 25;

// ─── Types ───────────────────────────────────────────────────────────────

export interface ReconcileResult {
  /** Recommended hole — may equal the current hole (no change). */
  hole_number: number;
  /** True iff the recommendation differs from the current hole. */
  changed: boolean;
  /** True iff setCurrentHole was actually invoked. (Changed but not
   *  applied happens when a safety gate blocks the swap — e.g. backward
   *  jump, accuracy too low.) */
  applied: boolean;
  /** 0-100 — combines proximity to active zone, gap to next-best hole,
   *  and GPS accuracy. Useful for the UI to surface "snapped — high
   *  confidence" vs "stayed put — uncertain." */
  confidence: number;
  /** Free-text explanation. Always devLog'd; surfaced in UI if needed. */
  reason: string;
  /** When accuracy is too low to act, this is set so the UI can show a
   *  toast / banner instead of silently doing nothing. */
  accuracy_warning?: string;
}

interface HoleScore {
  hole: number;
  /** Lower is better. min(dist-to-tee, dist-to-green). */
  score: number;
  distToTee: number;
  distToGreen: number;
  /** Player is within an "active zone" for this hole — either close to
   *  the tee (queueing up) or close to the green (approach + putt). */
  inActiveZone: boolean;
}

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Reconcile the current hole against a fresh GPS fix.
 *
 * Pure function w.r.t. the round store EXCEPT for a single
 * `useRoundStore.getState().setCurrentHole(...)` call when the swap is
 * applied. Everything else is read-only. Safe to call from anywhere.
 *
 * @param newFix - the GPS fix to reconcile against
 * @param force  - true when called from a user-initiated refresh button.
 *                 Lowers the swap threshold but never bypasses backward-
 *                 jump prevention or the accuracy gate.
 */
export function reconcileCurrentHole(newFix: GpsFix, force = false): ReconcileResult {
  const round = useRoundStore.getState();
  const currentHole = round.currentHole;

  if (!round.isRoundActive) {
    return {
      hole_number: currentHole,
      changed: false,
      applied: false,
      confidence: 0,
      reason: 'no active round',
    };
  }

  const courseId = round.activeCourseId;
  if (!courseId) {
    return {
      hole_number: currentHole,
      changed: false,
      applied: false,
      confidence: 0,
      reason: 'no active course id',
    };
  }

  // ─── Accuracy gate ─────────────────────────────────────────────────
  // Refuse to act on a junk fix — surfacing a warning is better UX
  // than guessing wrong and yanking the player to a wrong hole.
  const accuracy_m = newFix.accuracy_m;
  if (accuracy_m != null && accuracy_m > ACCURACY_WARN_THRESHOLD_M) {
    const warning = `GPS accuracy weak (~${Math.round(accuracy_m)}m). Step into open sky and try again.`;
    devLog(`[reconcile] accuracy-gate hit: ${warning}`);
    return {
      hole_number: currentHole,
      changed: false,
      applied: false,
      confidence: 0,
      reason: `accuracy ${Math.round(accuracy_m)}m exceeds ${ACCURACY_WARN_THRESHOLD_M}m threshold`,
      accuracy_warning: warning,
    };
  }

  // ─── Score every hole on the course ────────────────────────────────
  // 2026-05-22 — Sustained heading tie-breaker. When the player is
  // moving in a sustained direction (e.g. walking down a fairway), the
  // hole whose tee→green axis matches that direction gets a small
  // proximity bonus. Breaks the parallel-hole / dogleg ambiguity where
  // two holes are geometrically close.
  const sustainedHeading = getSustainedHeading();
  const totalHoles = round.courseHoles.length > 0 ? round.courseHoles.length : 18;
  const scores: HoleScore[] = [];
  for (let h = 1; h <= totalHoles; h++) {
    const geom = getHoleGeometry(courseId, h);
    if (!geom?.tee || !geom?.green) continue;
    const distToTee = haversineYards({ lat: newFix.lat, lng: newFix.lng }, geom.tee);
    const distToGreen = haversineYards({ lat: newFix.lat, lng: newFix.lng }, geom.green);
    const inActiveZone =
      distToTee < TEE_ACTIVE_RADIUS_YD || distToGreen < GREEN_ACTIVE_RADIUS_YD;
    let score = Math.min(distToTee, distToGreen);

    // Apply heading-alignment bonus when both signals are available.
    if (sustainedHeading != null && geom.bearing_deg != null) {
      const delta = Math.abs(angleDeltaDeg(sustainedHeading, geom.bearing_deg));
      if (delta <= HEADING_ALIGN_TOL_DEG) {
        score = Math.max(0, score - HEADING_BONUS_YD);
      }
    }
    scores.push({
      hole: h,
      score,
      distToTee,
      distToGreen,
      inActiveZone,
    });
  }

  if (scores.length === 0) {
    devLog('[reconcile] no hole geometry available for course; cannot reconcile');
    return {
      hole_number: currentHole,
      changed: false,
      applied: false,
      confidence: 0,
      reason: 'no hole geometry available',
    };
  }

  // Sort ascending — best (lowest score) first.
  scores.sort((a, b) => a.score - b.score);
  const best = scores[0];
  const currentScore = scores.find(s => s.hole === currentHole);

  // ─── Backward-jump prevention ──────────────────────────────────────
  // Hard rule: never auto-recommend a hole the player has already
  // started (a score is logged for it) OR a hole number lower than the
  // current hole. The player can step back manually via DataStrip ◀
  // or voice "I'm on hole N" if they genuinely walked back (lost ball,
  // forgot a club, etc.) — that's the right surface for backward moves
  // because the user is explicit about the direction.
  const scoresByHole = round.scores;
  if (best.hole < currentHole || scoresByHole[best.hole] != null) {
    const reason = best.hole < currentHole
      ? `best candidate hole ${best.hole} is BEHIND current hole ${currentHole} — never auto-go-back`
      : `best candidate hole ${best.hole} already played (score=${scoresByHole[best.hole]}) — never re-enter`;
    devLog(`[reconcile] backward-gate blocked: ${reason}`);
    return {
      hole_number: currentHole,
      changed: false,
      applied: false,
      confidence: computeConfidence(currentScore, scores, accuracy_m),
      reason,
    };
  }

  // ─── Current-hole bias ─────────────────────────────────────────────
  // The current hole gets a head-start. The challenger has to beat it
  // by a meaningful margin or we stay put. Force-mode (user pressed
  // Refresh) lowers the margin so a clearly-different hole DOES snap.
  const margin = force ? RECONCILE_MARGIN_FORCE_YD : RECONCILE_MARGIN_NON_FORCE_YD;

  if (best.hole === currentHole) {
    devLog(`[reconcile] best candidate IS current hole ${currentHole} (${Math.round(best.score)}y)`);
    return {
      hole_number: currentHole,
      changed: false,
      applied: false,
      confidence: computeConfidence(best, scores, accuracy_m),
      reason: `already on best hole ${currentHole} (${Math.round(best.score)}y to active zone)`,
    };
  }

  // currentScore could be undefined if the player is on a hole with no
  // bundled geometry (unlikely but possible on a co-located-course
  // edge case). In that case, allow the swap unconditionally on force.
  const improvement = currentScore != null
    ? currentScore.score - best.score
    : Infinity;

  if (improvement < margin) {
    const conf = computeConfidence(currentScore, scores, accuracy_m);
    devLog(
      `[reconcile] stayed on hole ${currentHole} (${Math.round(currentScore?.score ?? Infinity)}y, conf ${conf})` +
      ` vs hole ${best.hole} (${Math.round(best.score)}y, ${Math.round(improvement)}y improvement < ${margin}y margin${force ? ' force' : ''})`,
    );
    return {
      hole_number: currentHole,
      changed: false,
      applied: false,
      confidence: conf,
      reason: `stayed on hole ${currentHole} — hole ${best.hole} only ${Math.round(improvement)}y closer (need ${margin}y${force ? ' force' : ''})`,
    };
  }

  // ─── Swap ──────────────────────────────────────────────────────────
  const confidence = computeConfidence(best, scores, accuracy_m);
  devLog(
    `[reconcile] SWAP hole ${currentHole}→${best.hole} (improvement ${Math.round(improvement)}y, conf ${confidence}${force ? ', force' : ''})`,
  );
  useRoundStore.getState().setCurrentHole(best.hole);
  return {
    hole_number: best.hole,
    changed: true,
    applied: true,
    confidence,
    reason: `snapped to hole ${best.hole} (${Math.round(best.score)}y) from hole ${currentHole} (${Math.round(currentScore?.score ?? Infinity)}y), ${Math.round(improvement)}y improvement${force ? ' [force]' : ''}`,
  };
}

/**
 * Convenience wrapper for the "Refresh GPS" button. Reads the latest
 * fix from gpsManager and runs reconciliation in force mode. Returns
 * the result for the UI to display (e.g., toast on snap, banner on
 * accuracy warning).
 *
 * Safe to call when no fix is available — returns a no-op result
 * with confidence 0.
 */
export function forceHoleReconciliation(): ReconcileResult {
  // Lazy import to avoid a module-load cycle (gpsManager imports may
  // touch services that depend on the round store).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const gps = require('./gpsManager') as typeof import('./gpsManager');
  const fix = gps.getLastFix();
  if (!fix) {
    devLog('[reconcile] forceHoleReconciliation called with no fix available');
    return {
      hole_number: useRoundStore.getState().currentHole,
      changed: false,
      applied: false,
      confidence: 0,
      reason: 'no GPS fix available — try again after a fresh fix',
    };
  }
  return reconcileCurrentHole(fix, true);
}

// ─── Confidence helper ───────────────────────────────────────────────────

/**
 * 0-100 confidence score combining three signals:
 *   1. Proximity to active zone (how close the picked hole's tee/green is)
 *   2. Gap between best and second-best hole (clear winner vs tied)
 *   3. GPS accuracy (lower meters = higher confidence)
 *
 * Each contributes a weighted slice of the final score.
 */
function computeConfidence(
  pick: HoleScore | undefined,
  allScores: HoleScore[],
  accuracy_m: number | null,
): number {
  if (!pick) return 0;

  // 1. Proximity: 0y → 100, 100y → 0.
  const proximityScore = Math.max(0, Math.min(100, 100 - pick.score));

  // 2. Gap to next-best: bigger gap = higher confidence. 50y gap →
  //    full 100; 0y gap → 0.
  const second = allScores.find(s => s.hole !== pick.hole);
  const gap = second ? Math.max(0, second.score - pick.score) : 100;
  const gapScore = Math.min(100, gap * 2);

  // 3. Accuracy: <5m → 100, >30m → ~0 (gate already blocked >30 but
  //    accuracy in the 15-29 range still affects confidence).
  const accScore = accuracy_m == null
    ? 60 // unknown accuracy — neutral
    : Math.max(0, Math.min(100, 100 - (accuracy_m - 5) * 4));

  // Weighted blend — proximity matters most, then gap, then accuracy.
  const blended = proximityScore * 0.5 + gapScore * 0.3 + accScore * 0.2;
  return Math.round(Math.max(0, Math.min(100, blended)));
}

/**
 * Smallest signed angle between two bearings (in degrees). Returns a value
 * in (-180, 180]. Caller typically wants Math.abs() to compare to a
 * tolerance window.
 */
function angleDeltaDeg(a: number, b: number): number {
  let d = ((a - b) % 360 + 540) % 360 - 180;
  return d;
}
