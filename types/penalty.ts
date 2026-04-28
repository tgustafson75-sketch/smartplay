import type { ShotOutcome } from './shot';

export interface PenaltyEvent {
  shot_id: string;
  hole_number: number;
  outcome: ShotOutcome;
  penalty_strokes: number;
  rules_decision?: 'stroke_and_distance' | 'play_forward';
  kevin_commentary?: string;
}

export type RulesDecision = 'stroke_and_distance' | 'play_forward';
