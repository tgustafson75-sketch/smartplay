/**
 * Hole reconciliation — user-initiated "where am I?" against fresh GPS.
 *
 * Distinct from services/holeDetection.ts (the dormant background
 * auto-advance gated by settings.autoHoleAdvance). This is the explicit
 * "tell me which hole I'm on" surface a player taps when the app drifts.
 *
 * Three safety rules apply to both auto and force modes:
 *   1. Never auto-jump backward to a played hole.
 *   2. Refuse on weak GPS (>30m accuracy) — surface a warning instead.
 *   3. Current-hole bias — challenger must beat by margin to swap.
 *
 * Force mode (user tapped Refresh GPS) lowers the swap margin so a
 * clearly different hole DOES snap. Non-force keeps the conservative
 * threshold for auto-trigger paths.
 *
 * Sustained-heading tie-breaker (via courseDataOrchestrator) prefers
 * the hole the player is moving ALONG (tee→green bearing match) over a
 * parallel hole they're moving away from.
 */

import { getHoleGeometry } from './courseGeometryService';
import { haversineYards } from '../utils/geoDistance';
import { useRoundStore } from '../store/roundStore';
import { getSustainedHeading } from './courseDataOrchestrator';
import { getLastFix, type GpsFix } from './gpsManager';
import { devLog } from './devLog';

// ─── Tunables (golf rationale) ───────────────────────────────────────
//   NON_FORCE 55y: auto-checks shouldn't whiplash the player — leave the
//     current hole alone unless a challenger is clearly better.
//   FORCE 30y: user explicitly asked "where am I?" — be more eager.
//   ACCURACY 30m: ~one fairway-width; below this we trust the fix.
//   HEADING_TOL 20° / BONUS 25y: nudges ties between parallel holes
//     without overriding a clear proximity winner.
const NON_FORCE_MARGIN_YD  = 55;
const FORCE_MARGIN_YD      = 30;
const ACCURACY_THRESHOLD_M = 30;
const HEADING_TOL_DEG      = 20;
const HEADING_BONUS_YD     = 25;

export interface ReconcileResult {
  hole_number: number;
  changed: boolean;
  applied: boolean;
  confidence: number;
  reason: string;
  accuracy_warning?: string;
}

interface HoleScore { hole: number; score: number }

/**
 * Reconcile the current hole against a fresh GPS fix. Pure w.r.t. the
 * round store except for a single setCurrentHole() when applied.
 */
export function reconcileCurrentHole(fix: GpsFix, force = false): ReconcileResult {
  const round = useRoundStore.getState();
  const currentHole = round.currentHole;
  const stay = (
    reason: string,
    confidence = 0,
    extra: Partial<ReconcileResult> = {},
  ): ReconcileResult => ({
    hole_number: currentHole, changed: false, applied: false, confidence, reason, ...extra,
  });

  if (!round.isRoundActive)  return stay('no active round');
  if (!round.activeCourseId) return stay('no active course id');

  // Accuracy gate — refuse and warn instead of guessing.
  const acc = fix.accuracy_m;
  if (acc != null && acc > ACCURACY_THRESHOLD_M) {
    const warning = `GPS accuracy weak (~${Math.round(acc)}m). Step into open sky and try again.`;
    devLog(`[reconcile] accuracy-gate: ${warning}`);
    return stay(
      `accuracy ${Math.round(acc)}m > ${ACCURACY_THRESHOLD_M}m`,
      0,
      { accuracy_warning: warning },
    );
  }

  // Score every hole with usable geometry.
  const sustained = getSustainedHeading();
  const total = round.courseHoles.length || 18;
  const scores: HoleScore[] = [];
  for (let h = 1; h <= total; h++) {
    const geom = getHoleGeometry(round.activeCourseId, h);
    if (!geom?.tee || !geom?.green) continue;
    const dTee = haversineYards({ lat: fix.lat, lng: fix.lng }, geom.tee);
    const dGreen = haversineYards({ lat: fix.lat, lng: fix.lng }, geom.green);
    let score = Math.min(dTee, dGreen);
    if (sustained != null && geom.bearing_deg != null) {
      const delta = Math.abs(((sustained - geom.bearing_deg) % 360 + 540) % 360 - 180);
      if (delta <= HEADING_TOL_DEG) score = Math.max(0, score - HEADING_BONUS_YD);
    }
    scores.push({ hole: h, score });
  }
  if (!scores.length) return stay('no hole geometry available');

  scores.sort((a, b) => a.score - b.score);
  const best = scores[0];
  const current = scores.find(s => s.hole === currentHole);

  // Backward gate — never recommend a played hole or one behind current.
  if (best.hole < currentHole || round.scores[best.hole] != null) {
    const reason = best.hole < currentHole
      ? `hole ${best.hole} behind current ${currentHole}`
      : `hole ${best.hole} already played`;
    devLog(`[reconcile] backward-gate: ${reason}`);
    return stay(reason, computeConfidence(best, scores, acc));
  }

  // Current-hole bias.
  if (best.hole === currentHole) {
    return stay(
      `on best hole ${currentHole} (${Math.round(best.score)}y)`,
      computeConfidence(best, scores, acc),
    );
  }
  const margin = force ? FORCE_MARGIN_YD : NON_FORCE_MARGIN_YD;
  const improvement = current ? current.score - best.score : Infinity;
  if (improvement < margin) {
    devLog(
      `[reconcile] stayed on ${currentHole}: ${Math.round(improvement)}y < ${margin}y${force ? ' force' : ''}`,
    );
    return stay(
      `hole ${best.hole} only ${Math.round(improvement)}y closer (need ${margin}y${force ? ' force' : ''})`,
      computeConfidence(current, scores, acc),
    );
  }

  // Swap.
  const confidence = computeConfidence(best, scores, acc);
  devLog(
    `[reconcile] SWAP ${currentHole}→${best.hole} ${Math.round(improvement)}y conf=${confidence}${force ? ' force' : ''}`,
  );
  useRoundStore.getState().setCurrentHole(best.hole);
  return {
    hole_number: best.hole,
    changed: true,
    applied: true,
    confidence,
    reason: `snapped to hole ${best.hole} (${Math.round(improvement)}y improvement${force ? ' [force]' : ''})`,
  };
}

/** Read the latest fix from gpsManager and run reconciliation in force mode. */
export function forceHoleReconciliation(): ReconcileResult {
  const fix = getLastFix();
  if (!fix) {
    devLog('[reconcile] no GPS fix available');
    return {
      hole_number: useRoundStore.getState().currentHole,
      changed: false,
      applied: false,
      confidence: 0,
      reason: 'no GPS fix — try again after a fresh fix',
    };
  }
  return reconcileCurrentHole(fix, true);
}

// 0..100 confidence: proximity 50% + gap-to-second 30% + accuracy 20%.
function computeConfidence(
  pick: HoleScore | undefined,
  all: HoleScore[],
  accuracy_m: number | null,
): number {
  if (!pick) return 0;
  const proximity = Math.max(0, Math.min(100, 100 - pick.score));
  const second = all.find(s => s.hole !== pick.hole);
  const gap = second ? Math.max(0, second.score - pick.score) : 100;
  const gapScore = Math.min(100, gap * 2);
  const accScore = accuracy_m == null
    ? 60
    : Math.max(0, Math.min(100, 100 - (accuracy_m - 5) * 4));
  return Math.round(proximity * 0.5 + gapScore * 0.3 + accScore * 0.2);
}
