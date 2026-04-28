import type { ShotOutcome } from './shot';

export type RoundMode = 'break_100' | 'break_90' | 'break_80' | 'free_play';

export const ROUND_MODE_LABELS: Record<RoundMode, string> = {
  break_100: 'BREAK 100',
  break_90: 'BREAK 90',
  break_80: 'BREAK 80',
  free_play: 'FREE PLAY',
};

export const ROUND_MODE_CARDS: Record<RoundMode, { title: string; description: string }> = {
  break_100: { title: 'Break 100', description: 'First goal. Avoid blow-up holes. Bogey is gold.' },
  break_90:  { title: 'Break 90',  description: 'Smart misses. Lay up when in doubt. Pars matter.' },
  break_80:  { title: 'Break 80',  description: 'Aggressive but disciplined. Hunt birdies, manage risk.' },
  free_play: { title: 'Free Play', description: 'Just play. Kevin keeps it casual.' },
};

export interface PatternInsights {
  generated_at: number;
  shot_count_analyzed: number;
  insights: string[];
  raw_stats: {
    last_5_shots_breakdown:  { left: number; straight: number; right: number };
    last_10_shots_breakdown: { left: number; straight: number; right: number };
    miss_tendency_overall:          'left' | 'straight' | 'right' | 'balanced';
    miss_tendency_under_pressure:   'left' | 'straight' | 'right' | 'balanced' | 'insufficient_data';
    strengths: string[];
    streak: { type: 'good' | 'rough' | 'neutral'; length: number };
    penalty_event_count_by_outcome: Partial<Record<ShotOutcome, number>>;
    penalty_holes_count: number;
    recurring_trouble_holes: number[];
  };
}
