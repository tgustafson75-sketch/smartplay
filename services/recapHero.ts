import type { RoundRecap } from '../types/plan';

export interface RecapHero {
  type: 'ghost_win' | 'mode_breakthrough' | 'default';
  headline: string;
  detail: string;
}

// 2026-06-04 — HolePlan removed. The 'exceptional_hole' and 'best_save'
// hero types depended on `HoleComparison.variance` (planned-vs-actual).
// Without plans, per-hole "good shot" / "saved par" detection would
// require par data threaded through the comparison, which we don't carry.
// Reduced to ghost_win > mode_breakthrough > default.

const MODE_TARGETS: Record<string, number> = {
  break_100: 100,
  break_90:  90,
  break_80:  80,
};

export function computeRecapHero(recap: RoundRecap): RecapHero {
  // 1. Ghost variance >= 3 strokes won
  if (recap.ghost_match?.overall_delta != null && recap.ghost_match.overall_delta <= -3) {
    const d = Math.abs(recap.ghost_match.overall_delta);
    return {
      type: 'ghost_win',
      headline: `Beat past you by ${d}`,
      detail: `${d} stroke${d > 1 ? 's' : ''} better than ${recap.ghost_match.ghost_round_label ?? 'your last round'}.`,
    };
  }

  // 2. Mode breakthrough — scored under target
  const target = MODE_TARGETS[recap.mode];
  if (target && recap.total_score < target) {
    return {
      type: 'mode_breakthrough',
      headline: `${recap.mode.replace('_', ' ')} — done`,
      detail: `${recap.total_score} — ${target - recap.total_score} under target.`,
    };
  }

  // 3. Default — total score
  const completedHoles = recap.hole_comparisons.filter(hc => hc.actual_score != null).length;
  return {
    type: 'default',
    headline: `${completedHoles} holes complete`,
    detail: `Shot ${recap.total_score}. Every round builds the foundation.`,
  };
}
