import type { RoundRecap, HoleComparison } from '../types/plan';
import type { RoundMode } from '../types/patterns';
import type { ShareCardProps } from '../components/RoundShareCard';

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function pickHeroStat(recap: RoundRecap): string {
  const comparisons = recap.hole_comparisons.filter(hc => hc.actual_score != null);
  if (comparisons.length === 0) return `${recap.hole_comparisons.length} holes played`;

  // Ghost match win
  if (recap.ghost_match && recap.ghost_match.overall_delta != null) {
    const d = recap.ghost_match.overall_delta;
    if (d < 0) return `Beat your past round by ${Math.abs(d)} stroke${Math.abs(d) > 1 ? 's' : ''}`;
    if (d === 0) return 'Tied your past round exactly';
  }

  // Best hole vs par
  let bestVariance: number | null = null;
  let bestHole: HoleComparison | null = null;
  for (const hc of comparisons) {
    if (hc.variance != null && (bestVariance == null || hc.variance < bestVariance)) {
      bestVariance = hc.variance;
      bestHole = hc;
    }
  }

  if (bestHole && bestVariance != null) {
    if (bestVariance <= -2) return `Eagle on hole ${bestHole.hole_number}`;
    if (bestVariance === -1) return `Birdie on hole ${bestHole.hole_number}`;
    if (bestVariance === 0) return `Par on hole ${bestHole.hole_number}`;
  }

  // 2026-05-17 — Score vs par. Was: ternary `hc.plan?.markers?.tee ?
  // 4 : 4` which returned 4 either way, breaking the hero stat for
  // every non-par-72 round. RoundRecap doesn't carry course par per
  // hole; the next-best signal is total_planned_score (user's planned
  // total for the round, set in pre-round). Falls back to 4-per-hole
  // when the player skipped pre-round planning, which is the same
  // intent the previous buggy ternary was reaching for.
  const totalPar = recap.total_planned_score ?? comparisons.length * 4;
  const svp = recap.total_score - totalPar;
  if (svp <= 0) return `${Math.abs(svp)} under for the round`;
  if (svp <= 5) return `${svp} over for the round`;
  return `${comparisons.length} holes completed`;
}

export function pickKevinQuote(recap: RoundRecap): string {
  const summaries = recap.hole_comparisons
    .map(hc => hc.kevin_summary)
    .filter((s): s is string => !!s && s.length > 20);

  if (summaries.length === 0) {
    return recap.overall_kevin_summary ?? 'Good work out there today.';
  }

  // Prefer hole summaries with concrete observations (longer = more specific)
  summaries.sort((a, b) => b.length - a.length);
  return summaries[0];
}

export function buildShareCardProps(recap: RoundRecap): ShareCardProps {
  return {
    courseName: recap.course_name,
    date: formatDate(recap.ended_at),
    totalScore: recap.total_score,
    mode: recap.mode as RoundMode,
    ghostVariance: recap.ghost_match?.overall_delta ?? null,
    ghostLabel: recap.ghost_match?.ghost_round_label ?? null,
    heroStat: pickHeroStat(recap),
    kevinQuote: pickKevinQuote(recap),
  };
}
