import type { RoundRecap } from '../types/plan';
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

  // 2026-06-04 — HolePlan removed. Per-hole "best hole vs par" detection
  // and total_planned_score are gone. Fallback: assume par 4 per played
  // hole (same intent as the previous fallback when no plan was set).
  const totalPar = comparisons.length * 4;
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
