/*
 * KEVIN VOICE TEST PROMPTS — run after build to verify mode-aware + pattern-aware responses:
 *
 * 1. Break 100 mode, par 4 with water — ask: "Should I go for it?"
 *    Expect: lay-up recommendation, "bogey is fine", conservative language.
 *
 * 2. Break 80 mode, same scenario — ask: "Should I go for it?"
 *    Expect: positive risk framing, go-for-it energy if conditions allow.
 *
 * 3. Mock +5 right misses via debug screen, hole with right-side trouble — ask: "What's the play?"
 *    Expect: subtle left-side aim suggestion, no lecturing. Kevin uses patterns silently.
 */

import { STRENGTH_LABEL_BREAKS } from '../constants/handicapTiers';
import type { ShotResult, CourseHole } from '../store/roundStore';
import type { RoundMode, PatternInsights } from '../types/patterns';
import type { ShotOutcome } from '../types/shot';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function countDirections(shots: ShotResult[]): { left: number; straight: number; right: number } {
  const counts = { left: 0, straight: 0, right: 0 };
  for (const shot of shots) {
    if (shot.direction === 'left')     counts.left++;
    else if (shot.direction === 'right')    counts.right++;
    else if (shot.direction === 'straight') counts.straight++;
  }
  return counts;
}

function dominantDirection(
  counts: { left: number; straight: number; right: number },
): 'left' | 'straight' | 'right' | 'balanced' {
  const total = counts.left + counts.straight + counts.right;
  if (total === 0) return 'balanced';
  const sorted = (
    [
      ['left',     counts.left],
      ['straight', counts.straight],
      ['right',    counts.right],
    ] as [string, number][]
  ).sort((a, b) => b[1] - a[1]);

  const [topKey, topVal] = sorted[0];
  const [, runnerUp]     = sorted[1];
  // Must be >50% more than the next-highest to be called a tendency
  if (topVal > 0 && topVal > runnerUp * 1.5) {
    return topKey as 'left' | 'straight' | 'right';
  }
  return 'balanced';
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function generatePatternInsights(
  shots: ShotResult[],
  options?: {
    currentRoundMode?: RoundMode;
    scores?: Record<number, number>;
    courseHoles?: CourseHole[];
    handicap?: number;
    dominantMiss?: 'left' | 'right' | 'straight' | null;
  },
): PatternInsights {
  const mode       = options?.currentRoundMode ?? 'free_play';
  const scores     = options?.scores           ?? {};
  const courseHoles = options?.courseHoles     ?? [];

  const last5  = shots.slice(-5);
  const last10 = shots.slice(-10);

  const last_5_shots_breakdown  = countDirections(last5);
  const last_10_shots_breakdown = countDirections(last10);
  const miss_tendency_overall   = dominantDirection(countDirections(shots));

  // ── Pressure shots ─────────────────────────────────────────────────────────
  // A hole is "pressure" if the final score exceeded the mode's tolerance threshold.
  const pressureThreshold: Record<RoundMode, number> = {
    break_80:  0,  // any bogey+ is pressure
    break_90:  1,  // worse than +1
    break_100: 2,  // worse than +2
    free_play: 2,
  };
  const threshold = pressureThreshold[mode];

  const pressureShots = shots.filter(shot => {
    const score = scores[shot.hole];
    if (score == null) return false;
    const par = courseHoles.find(h => h.hole === shot.hole)?.par ?? 4;
    return (score - par) > threshold;
  });

  const miss_tendency_under_pressure: PatternInsights['raw_stats']['miss_tendency_under_pressure'] =
    pressureShots.length >= 5
      ? dominantDirection(countDirections(pressureShots))
      : 'insufficient_data';

  // ── Strengths (from profile data) ──────────────────────────────────────────
  const strengths: string[] = [];
  if (options?.dominantMiss === 'straight') strengths.push('consistent ball-striking');
  if (options?.handicap != null) {
    if (options.handicap <= STRENGTH_LABEL_BREAKS.precision)        strengths.push('low-handicap precision');
    else if (options.handicap <= STRENGTH_LABEL_BREAKS.management)  strengths.push('skilled course management');
    else if (options.handicap <= STRENGTH_LABEL_BREAKS.fundamentals) strengths.push('solid fundamentals');
  }

  // ── Streak ─────────────────────────────────────────────────────────────────
  const last3 = shots.slice(-3);
  const streak: PatternInsights['raw_stats']['streak'] = (() => {
    if (last3.length < 2) return { type: 'neutral', length: 0 };
    const goodShots = last3.filter(
      s => s.direction === 'straight' && (s.feel === 'flush' || s.feel === 'solid'),
    );
    const badShots = last3.filter(
      s => s.direction === 'left' || s.direction === 'right' ||
           s.feel === 'fat' || s.feel === 'thin',
    );
    if (goodShots.length === last3.length) return { type: 'good',    length: last3.length };
    if (badShots.length >= 2)              return { type: 'rough',   length: badShots.length };
    return                                        { type: 'neutral', length: 0 };
  })();

  // ── Penalty patterns ───────────────────────────────────────────────────────
  const last50 = shots.slice(-50);
  const penaltyShots = last50.filter(s => s.outcome && s.outcome !== 'clean');
  const penaltyCountByOutcome: Partial<Record<ShotOutcome, number>> = {};
  for (const s of penaltyShots) {
    const o = s.outcome as ShotOutcome;
    penaltyCountByOutcome[o] = (penaltyCountByOutcome[o] ?? 0) + 1;
  }
  const penaltyHoles = new Set(penaltyShots.map(s => s.hole));
  const penalty_holes_count = penaltyHoles.size;
  // Holes with 2+ penalty shots in this window
  const holePenaltyCount: Record<number, number> = {};
  for (const s of penaltyShots) {
    holePenaltyCount[s.hole] = (holePenaltyCount[s.hole] ?? 0) + 1;
  }
  const recurring_trouble_holes = Object.entries(holePenaltyCount)
    .filter(([, count]) => count >= 2)
    .map(([hole]) => Number(hole))
    .sort((a, b) => a - b);

  // ── Plain-English insights (max 5, priority order) ─────────────────────────
  const insights: string[] = [];

  // 1 — Pressure tendency (highest signal)
  if (
    miss_tendency_under_pressure !== 'insufficient_data' &&
    miss_tendency_under_pressure !== 'balanced'
  ) {
    const pc = countDirections(pressureShots);
    const dir = miss_tendency_under_pressure;
    insights.push(
      `Under pressure, misses ${dir} ${pc[dir]} of last ${pressureShots.length} — Kevin should account for this.`,
    );
  }

  // 2 — Overall tendency
  if (miss_tendency_overall !== 'balanced' && insights.length < 5) {
    insights.push(
      `Misses ${miss_tendency_overall} more often than not — bring that into target selection.`,
    );
  }

  // 3 — Streak
  if (streak.type === 'good' && insights.length < 5) {
    insights.push('Hot streak — last 3 shots clean.');
  } else if (streak.type === 'rough' && insights.length < 5) {
    insights.push('Cooling off — last 3 had misses or rough contact.');
  }

  // 4 — Recent (last 5) breakdown
  if (insights.length < 5) {
    const dom5 = dominantDirection(last_5_shots_breakdown);
    if (dom5 !== 'balanced') {
      const count = last_5_shots_breakdown[dom5];
      const other = last5.length - count;
      if (count >= 3) {
        insights.push(`Last 5 shots: ${count} ${dom5}, ${other} elsewhere.`);
      }
    }
  }

  // 5 — Penalty patterns
  const waterCount = penaltyCountByOutcome.water ?? 0;
  if (waterCount >= 3 && insights.length < 5) {
    insights.push(`Water has been a theme — ${waterCount} drops in your last ${last50.length} shots.`);
  } else if (recurring_trouble_holes.length > 0 && insights.length < 5) {
    const holeStr = recurring_trouble_holes.slice(0, 2).map(h => `hole ${h}`).join(' and ');
    insights.push(`${holeStr.charAt(0).toUpperCase() + holeStr.slice(1)} ${recurring_trouble_holes.length === 1 ? 'has' : 'have'} caused trouble multiple times — let's plan those carefully.`);
  } else if (penaltyShots.length === 0 && last50.length >= 10 && insights.length < 5) {
    insights.push('Clean rounds lately — keeping it in play is a real edge.');
  }

  // 6 — Strengths
  if (strengths.length > 0 && insights.length < 5) {
    insights.push(`Strengths: ${strengths.join(', ')}.`);
  }

  return {
    generated_at:       Date.now(),
    shot_count_analyzed: shots.length,
    insights,
    raw_stats: {
      last_5_shots_breakdown,
      last_10_shots_breakdown,
      miss_tendency_overall,
      miss_tendency_under_pressure,
      strengths,
      streak,
      penalty_event_count_by_outcome: penaltyCountByOutcome,
      penalty_holes_count,
      recurring_trouble_holes,
    },
  };
}

// ─── Phase U Component 3 — Pattern shift detection ───────────────────

export interface PatternShift {
  axis: 'driver_miss' | 'overall_miss';
  from: 'left' | 'right' | 'straight' | 'balanced';
  to: 'left' | 'right' | 'straight' | 'balanced';
  rounds_consistent: number;
  severity: 'mild' | 'moderate' | 'significant';
  alert_message: string;
}

/**
 * Detect a meaningful drift in miss tendency across recent rounds.
 *
 * Threshold logic (Phase V — lowered minimum to surface trends earlier):
 *   • Need at least 4 total rounds (3 recent + 1 baseline minimum)
 *   • Recent window = last 3 rounds (no single-round noise)
 *   • Shift fires only when the recent-window tendency differs from the
 *     baseline-window tendency
 *   • Severity tag scales with confidence:
 *       baseline ≥ 4 rounds → significant
 *       baseline ≥ 2 rounds → moderate
 *       baseline = 1 round  → mild (early signal — flag with caveat)
 *   • Returns null when no meaningful shift exists (the dashboard then
 *     hides the alert card — no false alerts)
 *
 * Used by:
 *   • dashboard.tsx milestone card (proactive surface)
 *   • api/briefing.ts (pre-round mention when shift active)
 */
export function detectPatternShift(
  rounds: Array<{ shots: Array<{ direction: string | null; club: string | null }> }>,
): PatternShift | null {
  if (rounds.length < 4) return null;

  const recent = rounds.slice(-3);
  const baseline = rounds.slice(0, -3);
  if (baseline.length < 1) return null;

  function dominantOf(roundList: typeof rounds): 'left' | 'right' | 'straight' | 'balanced' {
    const counts = { left: 0, right: 0, straight: 0 };
    for (const r of roundList) {
      for (const s of r.shots) {
        if (s.direction === 'left') counts.left++;
        else if (s.direction === 'right') counts.right++;
        else if (s.direction === 'straight') counts.straight++;
      }
    }
    const total = counts.left + counts.right + counts.straight;
    if (total < 5) return 'balanced';
    const max = Math.max(counts.left, counts.right, counts.straight);
    const ratio = max / total;
    if (ratio < 0.45) return 'balanced';
    if (counts.left === max) return 'left';
    if (counts.right === max) return 'right';
    return 'straight';
  }

  const recentTendency = dominantOf(recent);
  const baselineTendency = dominantOf(baseline);
  if (recentTendency === baselineTendency) return null;
  // Only surface drift TO a directional miss (not random noise)
  if (recentTendency === 'balanced' && baselineTendency !== 'left' && baselineTendency !== 'right') return null;

  // Severity scales with baseline-window depth (more baseline = higher confidence)
  const severity: PatternShift['severity'] =
    baseline.length >= 4 ? 'significant' :
    baseline.length >= 2 ? 'moderate' : 'mild';

  const baseMessage =
    recentTendency === 'left' || recentTendency === 'right'
      ? `Your driver has trended ${recentTendency} across last ${recent.length} rounds. Worth a Gate Drill session before it sticks.`
      : recentTendency === 'balanced' && baselineTendency !== 'balanced'
        ? `Your ${baselineTendency} miss has cleaned up — last ${recent.length} rounds are balanced. Keep doing what you're doing.`
        : `Pattern shift detected: ${baselineTendency} → ${recentTendency} across ${recent.length} rounds.`;
  // Phase V — mild signals get a "early read" caveat so the user weights it appropriately
  const alert_message = severity === 'mild'
    ? `${baseMessage} (Early read — small baseline.)`
    : baseMessage;

  return {
    axis: 'driver_miss',
    from: baselineTendency,
    to: recentTendency,
    rounds_consistent: recent.length,
    severity,
    alert_message,
  };
}
