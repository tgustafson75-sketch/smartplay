import type { RoundRecap, HoleComparison } from '../types/plan';

export interface RecapHero {
  type: 'ghost_win' | 'mode_breakthrough' | 'exceptional_hole' | 'best_save' | 'default';
  headline: string;
  detail: string;
}

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

  // 3. Exceptional hole — eagle or better
  const comparisons = recap.hole_comparisons.filter(hc => hc.actual_score != null);
  const exceptional = comparisons.find(hc => (hc.variance ?? 999) <= -2);
  if (exceptional) {
    const label = exceptional.variance === -2 ? 'Eagle' : exceptional.variance === -3 ? 'Albatross' : 'Eagle or better';
    return {
      type: 'exceptional_hole',
      headline: `${label} — Hole ${exceptional.hole_number}`,
      detail: `${exceptional.actual_score} on a par ${(exceptional.actual_score ?? 0) - (exceptional.variance ?? 0)}.`,
    };
  }

  // 4. Best save — hole with biggest positive variance difference (planned well below par, executed near par)
  let bestSave: HoleComparison | null = null;
  let bestSaveDiff = -Infinity;
  for (const hc of comparisons) {
    if (hc.variance != null && hc.variance === 0) {
      // par on any hole is worth noting
      const diff = 1;
      if (diff > bestSaveDiff) { bestSaveDiff = diff; bestSave = hc; }
    }
  }
  if (bestSave) {
    return {
      type: 'best_save',
      headline: `Par save — Hole ${bestSave.hole_number}`,
      detail: 'Stayed disciplined when it mattered.',
    };
  }

  // 5. Default — total score
  return {
    type: 'default',
    headline: `${comparisons.length} holes complete`,
    detail: `Shot ${recap.total_score}. Every round builds the foundation.`,
  };
}
