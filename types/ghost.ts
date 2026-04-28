export interface GhostHoleResult {
  ghost_score: number | null;
  current_score: number;
  delta: number | null; // current - ghost; negative = winning
}

export interface GhostMatchSnapshot {
  ghost_round_id: string;
  ghost_round_label: string;
  ghost_total: number;
  hole_results: Record<number, GhostHoleResult>;
  overall_delta: number; // negative = ahead (winning)
  holes_compared: number;
}
