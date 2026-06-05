import type { RoundRecap } from '../types/plan';

export interface NarrationSegment {
  audio_text: string;
  hole_to_highlight: number | null;
}

export function buildNarrationScript(recap: RoundRecap): NarrationSegment[] {
  const segments: NarrationSegment[] = [];

  // Opener
  const opener = recap.overall_kevin_summary
    ? recap.overall_kevin_summary
    : `${recap.total_score} on the card at ${recap.course_name}. Let's walk through it.`;
  segments.push({ audio_text: opener, hole_to_highlight: null });

  // Hole highlights — only holes with a kevin_summary. 2026-06-04: the
  // prior "most interesting" sort used HolePlan-derived variance; with
  // plans removed we just take the first 4 by hole order.
  const notableHoles = recap.hole_comparisons
    .filter(hc => hc.actual_score != null && hc.kevin_summary && hc.kevin_summary.length > 10)
    .sort((a, b) => (a.hole_number ?? 0) - (b.hole_number ?? 0))
    .slice(0, 4);

  for (const hc of notableHoles) {
    if (hc.kevin_summary) {
      segments.push({
        audio_text: `Hole ${hc.hole_number}. ${hc.kevin_summary}`,
        hole_to_highlight: hc.hole_number,
      });
    }
  }

  // Ghost result if applicable
  if (recap.ghost_match?.overall_delta != null) {
    const d = recap.ghost_match.overall_delta;
    let ghostLine = '';
    if (d < 0) ghostLine = `And you beat ${recap.ghost_match.ghost_round_label ?? 'your past self'} by ${Math.abs(d)} stroke${Math.abs(d) > 1 ? 's' : ''}.`;
    else if (d === 0) ghostLine = `Tied ${recap.ghost_match.ghost_round_label ?? 'your past self'} exactly.`;
    else ghostLine = `${recap.ghost_match.ghost_round_label ?? 'Past you'} had the edge today by ${d}.`;
    segments.push({ audio_text: ghostLine, hole_to_highlight: null });
  }

  return segments;
}
