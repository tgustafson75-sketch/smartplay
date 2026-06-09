import type { HoleComparison, MatchedShot, RoundRecap } from '../types/plan';
import type { ShotResult, CourseHole } from '../store/roundStore';
import type { RoundMode } from '../types/patterns';
import type { GhostMatchSnapshot } from '../types/ghost';
import { saveRecap } from './planStorage';

// 2026-06-04 — HolePlan removed. Recap is actual-outcome only; no
// planned-vs-actual comparison and no `total_planned_score`. The
// MatchedShot label still tags each shot as tee/approach/pin by
// sequence so the recap surface can still group shots semantically.

// ─── Shot → result mapping ────────────────────────────────────────────────────

function shotResult(shot: ShotResult): MatchedShot['result'] {
  if (shot.direction === 'left')     return 'missed_left';
  if (shot.direction === 'right')    return 'missed_right';
  if (shot.feel === 'fat')           return 'short';
  if (shot.feel === 'thin')          return 'long';
  if (shot.direction === 'straight') return 'on_target';
  return 'unclassified';
}

const MARKER_ORDER: Array<MatchedShot['plan_marker']> = ['tee', 'approach', 'pin'];

function buildHoleComparison(
  holeNumber: number,
  shots: ShotResult[],
  score: number | null,
): HoleComparison {
  const matched_shots: MatchedShot[] = shots.map((shot, i) => ({
    plan_marker: MARKER_ORDER[Math.min(i, MARKER_ORDER.length - 1)],
    actual_shot: shot,
    result: shotResult(shot),
  }));

  return {
    hole_number: holeNumber,
    actual_shots: shots,
    actual_score: score,
    matched_shots,
    kevin_summary: null,
  };
}

// ─── Human-readable shot summary for the API ─────────────────────────────────

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
    // Phase V Component 2 — Arena practice context
    arenaContext?: {
      recent_sessions_count: number;
      recent_sessions: Array<{ reason: string; points: number; date: string }>;
      most_recent_date?: string | null;
    } | null;
    // Phase BR Component 9 — active tutorial practice context, pre-formatted
    // by services/tutorialContext.buildFullPracticeContext. Optional; null
    // when no tutorials are flagged active.
    practiceContext?: string | null;
    voiceGender?: 'male' | 'female';
    // 2026-05-21 — Fix Q: pass active persona so the recap renders in
    // the user's selected caddie's voice + perspective, not the server's
    // voiceGender→Kevin fallback.
    persona?: 'kevin' | 'serena' | 'harry' | 'tank' | 'custom';
  },
): Promise<RoundRecap> {
  const { courseName, courseId, mode, startedAt, endedAt, totalScore, scoreVsPar, scores, shots, courseHoles } = round;

  // Build hole comparisons for every scored hole
  const holeParsMap: Record<number, number> = {};
  for (const ch of courseHoles) holeParsMap[ch.hole] = ch.par;

  const scoredHoles = Object.keys(scores).map(Number).sort((a, b) => a - b);

  const hole_comparisons: HoleComparison[] = scoredHoles.map(holeNum => {
    const holeShots = shots.filter(s => s.hole === holeNum);
    const score = scores[holeNum] ?? null;
    return buildHoleComparison(holeNum, holeShots, score);
  });

  // Build API payload. 2026-06-09 (honesty) — only narrate holes whose par we
  // actually know. Defaulting unknown par to 4 made the recap assert wrong
  // score-vs-par phrasing; omit those holes from the par-based narration
  // instead of fabricating a par.
  const holes = hole_comparisons
    .filter(hc => typeof holeParsMap[hc.hole_number] === 'number')
    .map(hc => ({
      hole_number: hc.hole_number,
      par: holeParsMap[hc.hole_number],
      score: hc.actual_score,
      shots_summary: hc.actual_shots.length > 0 ? shotsSummary(hc.actual_shots) : null,
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
        // Phase V: Arena practice context
        arena_context: round.arenaContext ?? null,
        // Phase BR: active tutorial practice context (caller passes the
        // pre-formatted string from buildFullPracticeContext).
        practice_context: round.practiceContext ?? null,
        voiceGender: round.voiceGender ?? 'male',
        persona: round.persona,
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
    hole_comparisons: finalComparisons,
    overall_kevin_summary: overallSummary,
    ghost_match: round.ghostSnapshot ?? null,
  };

  await saveRecap(roundId, recap);
  console.log('[recap] saved for round', roundId, 'at', courseName);
  return recap;
}
