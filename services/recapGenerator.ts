import type { HolePlan, HoleComparison, MatchedShot, RoundRecap } from '../types/plan';
import type { ShotResult, CourseHole } from '../store/roundStore';
import type { RoundMode } from '../types/patterns';
import type { GhostMatchSnapshot } from '../types/ghost';
import { archivePlans, saveRecap } from './planStorage';

// ─── Shot → result mapping ────────────────────────────────────────────────────

function shotResult(shot: ShotResult): MatchedShot['result'] {
  if (shot.direction === 'left')     return 'missed_left';
  if (shot.direction === 'right')    return 'missed_right';
  if (shot.feel === 'fat')           return 'short';
  if (shot.feel === 'thin')          return 'long';
  if (shot.direction === 'straight') return 'on_plan';
  return 'off_plan';
}

const MARKER_ORDER: Array<MatchedShot['plan_marker']> = ['tee', 'approach', 'pin'];

function buildHoleComparison(
  holeNumber: number,
  par: number,
  plan: HolePlan | null,
  shots: ShotResult[],
  score: number | null,
  mode: RoundMode,
): HoleComparison {
  // Match shots to plan markers by sequence
  const matched_shots: MatchedShot[] = shots.map((shot, i) => ({
    plan_marker: MARKER_ORDER[Math.min(i, MARKER_ORDER.length - 1)],
    actual_shot: shot,
    distance_from_intended: null,
    result: shotResult(shot),
  }));

  // Planned score: par for break_80/free_play/break_90, par+1 for break_100
  const planned_score = plan
    ? (mode === 'break_100' ? par + 1 : mode === 'break_80' ? par - 1 : par)
    : null;

  const variance = planned_score != null && score != null
    ? score - planned_score
    : null;

  return {
    hole_number: holeNumber,
    plan,
    actual_shots: shots,
    planned_score,
    actual_score: score,
    variance,
    matched_shots,
    kevin_summary: null,
  };
}

// ─── Human-readable summaries for the API ────────────────────────────────────

function planSummary(plan: HolePlan): string {
  const t = plan.markers.tee;
  const a = plan.markers.approach;
  const p = plan.markers.pin;
  const parts: string[] = [];
  if (t.club_intent) parts.push(`${t.club_intent} off tee${plan.computed_yardages.from_tee_to_approach ? ' (' + plan.computed_yardages.from_tee_to_approach + 'y)' : ''}`);
  if (a?.club_intent) parts.push(`${a.club_intent} approach${plan.computed_yardages.from_approach_to_pin ? ' (' + plan.computed_yardages.from_approach_to_pin + 'y)' : ''}`);
  if (p?.club_intent) parts.push(`${p.club_intent} to pin`);
  const locked = plan.locked_at ? ' (locked)' : ' (draft)';
  return parts.length > 0 ? parts.join(', ') + locked : 'markers set' + locked;
}

function shotsSummary(shots: ShotResult[]): string {
  if (shots.length === 0) return 'no shots tracked';
  return shots.map((s, i) => {
    const dir = s.direction ?? 'unknown';
    const feel = s.feel ?? '';
    const club = s.club ? s.club + ' ' : '';
    const base = `shot ${i + 1}: ${club}${feel ? feel + ' ' : ''}${dir}`;
    if (!s.outcome || s.outcome === 'clean') return base;
    const penalty = (s.penalty_strokes ?? 0) > 0 ? ` (+${s.penalty_strokes} stroke)` : '';
    const rules = s.rules_decision ? ` [${s.rules_decision.replace('_', ' ')}]` : '';
    return `${base} — ${s.outcome}${penalty}${rules}`;
  }).join(', ');
}

// ─── Main generator ───────────────────────────────────────────────────────────

export async function generateRecap(
  roundId: string,
  round: {
    courseName: string;
    courseId: string | null;
    mode: RoundMode;
    startedAt: number;
    endedAt: number;
    totalScore: number;
    scoreVsPar: number;
    scores: Record<number, number>;
    plans: HolePlan[];
    shots: ShotResult[];
    courseHoles: CourseHole[];
    patternInsights: string[];
    playerName: string;
    apiUrl: string;
    ghostSnapshot?: GhostMatchSnapshot | null;
    // Phase U Component 1+2 — recap context enrichment.
    cageContext?: {
      recent_sessions_count: number;
      primary_issues: Array<{ issue_name: string; severity: string; occurrence_count: number; session_date: string }>;
      drill_recommendations?: Array<{ drill_name: string; target_issue: string }>;
      most_recent_session_date?: string | null;
    } | null;
    preRoundNotes?: string | null;
  },
): Promise<RoundRecap> {
  const { courseName, courseId, mode, startedAt, endedAt, totalScore, scoreVsPar, scores, plans, shots, courseHoles } = round;

  // Archive plans immediately
  await archivePlans(roundId, plans);

  // Build hole comparisons for every scored hole
  const holeParsMap: Record<number, number> = {};
  for (const ch of courseHoles) holeParsMap[ch.hole] = ch.par;

  const scoredHoles = Object.keys(scores).map(Number).sort((a, b) => a - b);

  const hole_comparisons: HoleComparison[] = scoredHoles.map(holeNum => {
    const plan = plans.find(p => p.hole_number === holeNum) ?? null;
    const holeShots = shots.filter(s => s.hole === holeNum);
    const score = scores[holeNum] ?? null;
    const par = holeParsMap[holeNum] ?? 4;
    return buildHoleComparison(holeNum, par, plan, holeShots, score, mode);
  });

  const total_planned_score = hole_comparisons.every(h => h.planned_score != null)
    ? hole_comparisons.reduce((acc, h) => acc + (h.planned_score ?? 0), 0)
    : null;

  // Build API payload
  const holes = hole_comparisons.map(hc => ({
    hole_number: hc.hole_number,
    par: holeParsMap[hc.hole_number] ?? 4,
    score: hc.actual_score,
    plan_summary: hc.plan ? planSummary(hc.plan) : null,
    shots_summary: hc.actual_shots.length > 0 ? shotsSummary(hc.actual_shots) : null,
    variance: hc.variance,
  }));

  // Call /api/recap for Kevin summaries
  let holeSummaries: Array<{ hole_number: number; summary: string }> = [];
  let overallSummary = 'Round complete. Keep building.';

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    const res = await fetch(round.apiUrl + '/api/recap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        player_name: round.playerName,
        course_name: courseName,
        mode,
        total_score: totalScore,
        score_vs_par: scoreVsPar,
        holes_played: scoredHoles.length,
        holes,
        pattern_insights: round.patternInsights,
        // Phase U: cage practice + pre-round focus context
        cage_context: round.cageContext ?? null,
        pre_round_notes: round.preRoundNotes ?? null,
      }),
    }).finally(() => clearTimeout(timeout));

    if (res.ok) {
      const data = await res.json() as {
        hole_summaries: Array<{ hole_number: number; summary: string }>;
        overall_summary: string;
      };
      holeSummaries = data.hole_summaries ?? [];
      overallSummary = data.overall_summary ?? overallSummary;
    } else {
      console.error('[recap] API returned', res.status);
    }
  } catch (err) {
    console.error('[recap] API call failed:', err instanceof Error ? err.message : err);
  }

  // Merge Kevin summaries back into comparisons
  const summaryMap: Record<number, string> = {};
  for (const hs of holeSummaries) summaryMap[hs.hole_number] = hs.summary;

  const finalComparisons = hole_comparisons.map(hc => ({
    ...hc,
    kevin_summary: summaryMap[hc.hole_number] ?? null,
  }));

  const recap: RoundRecap = {
    round_id: roundId,
    course_id: courseId ?? 'local',
    course_name: courseName,
    mode,
    started_at: startedAt,
    ended_at: endedAt,
    total_score: totalScore,
    total_planned_score,
    hole_comparisons: finalComparisons,
    overall_kevin_summary: overallSummary,
    ghost_match: round.ghostSnapshot ?? null,
  };

  await saveRecap(roundId, recap);
  console.log('[recap] saved for round', roundId, 'at', courseName);
  return recap;
}
