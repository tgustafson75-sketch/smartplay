import type { ShotResult } from '../store/roundStore';

// ─── HolePlan ─────────────────────────────────────────────────────────────────

export interface HolePlan {
  id: string;
  round_id: string;
  course_id: string;
  hole_number: number;
  player_id: string;
  created_at: number;
  locked_at: number | null;
  markers: {
    tee:      { x: number; y: number; club_intent: string | null; landmark_target: { name: string; description: string; position?: { x: number; y: number } } | null };
    approach: { x: number; y: number; club_intent: string | null; landmark_target: { name: string; description: string; position?: { x: number; y: number } } | null } | null;
    pin:      { x: number; y: number; club_intent: string | null; landmark_target: { name: string; description: string; position?: { x: number; y: number } } | null } | null;
  };
  computed_yardages: {
    from_tee_to_approach: number | null;
    from_approach_to_pin: number | null;
    total: number | null;
  };
  notes: string | null;
}

// ─── Comparison (post-round) ───────────────────────────────────────────────────

export interface MatchedShot {
  plan_marker: 'tee' | 'approach' | 'pin';
  actual_shot: ShotResult;
  distance_from_intended: number | null; // GPS-only; null when unavailable
  result: 'on_plan' | 'missed_left' | 'missed_right' | 'long' | 'short' | 'off_plan';
}

export interface HoleComparison {
  hole_number: number;
  plan: HolePlan | null;
  actual_shots: ShotResult[];
  planned_score: number | null;
  actual_score: number | null;
  variance: number | null; // actual - planned
  matched_shots: MatchedShot[];
  kevin_summary: string | null;
}

// ─── RoundRecap (archived) ────────────────────────────────────────────────────

export interface RoundRecap {
  round_id: string;
  course_id: string;
  course_name: string;
  mode: string;
  started_at: number;
  ended_at: number;
  total_score: number;
  total_planned_score: number | null;
  hole_comparisons: HoleComparison[];
  overall_kevin_summary: string | null;
}
