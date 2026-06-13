/**
 * 2026-06-13 — Tee-box score goals (the round-side sibling of SmartPlan goals).
 *
 * "Break 90 from the reds." "Break 50 on the front nine." "Break par from the
 * tips." A challenge that reframes how a course is played (Bryson's break-50
 * energy) — gamification layered on the scorecard + round history we already
 * keep. The brain already knows your scores and which tee you played; this
 * evaluates a goal against that history.
 *
 * PURE, SYNC, never throws — the caller passes the round history in. Honest:
 * a tee-specific goal counts ONLY rounds actually tagged with that tee, and
 * surfaces how many rounds were skipped for a missing tee (the nudge to tag it).
 * 'unspecified' tee = "any tee" so day-one goals aren't empty before tee
 * tracking accumulates. See memory: tee-box-score-goals, simplified-sophistication.
 */

import type { RoundRecord, TeeColor } from '../../store/roundStore';

export interface TeeScoreGoal {
  id: string;
  /** Which tee — 'unspecified' means ANY tee. */
  tee: TeeColor;
  /** Absolute total to beat (null when this is a beat-par goal). */
  targetScore: number | null;
  /** True = break par (scoreVsPar < 0); ignores targetScore. */
  beatPar: boolean;
  /** 9-hole goal vs 18. */
  nine: boolean;
  /** Optional: lock the goal to one course; null = any course. */
  courseId?: string | null;
  courseName?: string | null;
  createdAt: number;
}

export interface TeeGoalProgress {
  goal: TeeScoreGoal;
  /** Qualifying rounds (tee + holes + course matched). */
  attempts: number;
  /** Best (lowest) qualifying total, or null. */
  best: number | null;
  /** Best scoreVsPar among qualifying, or null. */
  bestVsPar: number | null;
  achieved: boolean;
  achievedAt: number | null;
  /** Most recent qualifying total. */
  recent: number | null;
  /** Strokes from target (best − target); + = still to go, ≤0 = done. Null for unmeasurable. */
  gap: number | null;
  /** Of the qualifying rounds, how many carried a real (non-unspecified) tee. */
  teeTrackedAttempts: number;
  /** Rounds skipped because a tee-specific goal required a tee they didn't record. */
  skippedNoTee: number;
  /** Honest one-line status. */
  note: string;
}

const TEE_LABEL: Record<TeeColor, string> = {
  unspecified: 'any tee',
  gold: 'the golds',
  blue: 'the blues',
  white: 'the whites',
  red: 'the reds',
};

/** Is this record a nine-hole round? Prefer the explicit flag, fall back to count. */
function isNineRound(r: RoundRecord): boolean {
  return r.nineHoleMode || r.holesPlayed <= 11;
}

function roundTee(r: RoundRecord): TeeColor {
  return r.selectedTee ?? 'unspecified';
}

/** Human label for a goal — "Break 90 from the reds (front 9)". */
export function describeTeeGoal(goal: TeeScoreGoal): string {
  const what = goal.beatPar ? 'Break par' : `Break ${goal.targetScore}`;
  const where = goal.courseName ? ` at ${goal.courseName}` : '';
  const holes = goal.nine ? ' (9 holes)' : '';
  return `${what} from ${TEE_LABEL[goal.tee]}${where}${holes}`;
}

/** Did this round meet the goal's score bar? */
function meetsTarget(goal: TeeScoreGoal, r: RoundRecord): boolean {
  if (goal.beatPar) return r.scoreVsPar < 0;
  return goal.targetScore != null && r.totalScore < goal.targetScore;
}

/**
 * Evaluate a tee-score goal against the player's round history. Pure.
 */
export function evaluateTeeGoal(goal: TeeScoreGoal, history: RoundRecord[]): TeeGoalProgress {
  const rounds = (history ?? []).filter((r) => r && r.totalScore > 0);

  // First filter on the dimensions that always apply (holes + course).
  const holeCourseMatch = rounds.filter(
    (r) => isNineRound(r) === goal.nine && (!goal.courseId || r.courseId === goal.courseId),
  );

  // Then the tee filter. 'unspecified' goal = any tee.
  const anyTee = goal.tee === 'unspecified';
  const qualifying = holeCourseMatch.filter((r) => anyTee || roundTee(r) === goal.tee);
  // Rounds that matched everything BUT the tee, because they never recorded one.
  const skippedNoTee = anyTee
    ? 0
    : holeCourseMatch.filter((r) => roundTee(r) === 'unspecified').length;

  if (qualifying.length === 0) {
    const base = `No ${goal.nine ? '9-hole ' : ''}rounds from ${TEE_LABEL[goal.tee]} yet.`;
    const nudge = skippedNoTee > 0
      ? ` ${skippedNoTee} round${skippedNoTee === 1 ? '' : 's'} didn't record a tee — pick your tee at the start to track this.`
      : ' Play one to start tracking.';
    return {
      goal, attempts: 0, best: null, bestVsPar: null, achieved: false, achievedAt: null,
      recent: null, gap: null, teeTrackedAttempts: 0, skippedNoTee, note: base + nudge,
    };
  }

  let best = Infinity;
  let bestVsPar = Infinity;
  let achievedAt: number | null = null;
  for (const r of qualifying) {
    if (r.totalScore < best) best = r.totalScore;
    if (r.scoreVsPar < bestVsPar) bestVsPar = r.scoreVsPar;
    if (meetsTarget(goal, r)) achievedAt = achievedAt == null ? r.endedAt : Math.min(achievedAt, r.endedAt);
  }
  // Most recent qualifying attempt by end time.
  const recent = qualifying.reduce((a, b) => (b.endedAt > a.endedAt ? b : a)).totalScore;
  const achieved = achievedAt != null;
  const teeTrackedAttempts = qualifying.filter((r) => roundTee(r) !== 'unspecified').length;

  const gap = goal.beatPar
    ? (bestVsPar === Infinity ? null : bestVsPar) // for par goals, gap = best vsPar (≤ -1 = done)
    : goal.targetScore != null && best !== Infinity
      ? best - (goal.targetScore - 1) // strokes to get UNDER the target (must be < target)
      : null;

  let note: string;
  if (achieved) {
    note = `Done — your best from ${TEE_LABEL[goal.tee]} is ${best}${goal.beatPar ? ` (${fmtVsPar(bestVsPar)})` : ''}.`;
  } else if (gap != null) {
    const strokes = goal.beatPar ? bestVsPar + 1 : gap; // how many to shave
    note = `Best ${best} over ${qualifying.length} attempt${qualifying.length === 1 ? '' : 's'} — ${strokes} to go.`;
  } else {
    note = `Best ${best} over ${qualifying.length} attempt${qualifying.length === 1 ? '' : 's'}.`;
  }
  if (skippedNoTee > 0) {
    note += ` (${skippedNoTee} untagged round${skippedNoTee === 1 ? '' : 's'} not counted.)`;
  }

  return {
    goal,
    attempts: qualifying.length,
    best: best === Infinity ? null : best,
    bestVsPar: bestVsPar === Infinity ? null : bestVsPar,
    achieved,
    achievedAt,
    recent,
    gap,
    teeTrackedAttempts,
    skippedNoTee,
    note,
  };
}

function fmtVsPar(v: number): string {
  if (v === 0) return 'even';
  return v > 0 ? `+${v}` : `${v}`;
}
