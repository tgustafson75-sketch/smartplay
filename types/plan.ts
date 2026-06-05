import type { ShotResult } from '../store/roundStore';
import type { GhostMatchSnapshot } from './ghost';

// 2026-06-04 — HolePlan / pre-round authoring removed entirely. The
// types below now describe ONLY actual-outcome data. Recap surface
// still renders per-hole shot detail; "planned vs outcome" comparison
// is gone (no course-database to draw plans against).

// ─── Per-shot outcome metadata ───────────────────────────────────────────────

export interface MatchedShot {
  /** Sequence-derived label so the recap can group shots by their place
   *  in the hole flow even without a plan. */
  plan_marker: 'tee' | 'approach' | 'pin';
  actual_shot: ShotResult;
  /** Outcome classification derived from shot.direction + shot.feel. */
  result: 'on_target' | 'missed_left' | 'missed_right' | 'long' | 'short' | 'unclassified';
}

export interface HoleComparison {
  hole_number: number;
  actual_shots: ShotResult[];
  actual_score: number | null;
  matched_shots: MatchedShot[];
  kevin_summary: string | null;
}

// ─── RoundRecap (archived) ──────────────────────────────────────────────────

export interface RoundRecap {
  round_id: string;
  course_id: string;
  course_name: string;
  mode: string;
  started_at: number;
  ended_at: number;
  total_score: number;
  hole_comparisons: HoleComparison[];
  overall_kevin_summary: string | null;
  ghost_match?: GhostMatchSnapshot | null;
}
