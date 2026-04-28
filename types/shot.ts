export type ShotOutcome =
  | 'clean'
  | 'water'
  | 'ob'
  | 'lost'
  | 'hazard_drop'
  | 'unplayable'
  | 'manual_penalty'; // More Menu quick-penalty — user flagged a penalty without categorizing it

export const OUTCOME_LABELS: Record<ShotOutcome, string> = {
  clean:          'Clean',
  water:          'Water',
  ob:             'OB',
  lost:           'Lost',
  hazard_drop:    'Hazard',
  unplayable:     'Unplayable',
  manual_penalty: 'Penalty',
};

export const OUTCOME_EMOJI: Record<ShotOutcome, string> = {
  clean:          '●',
  water:          '🌊',
  ob:             '🚫',
  lost:           '🔍',
  hazard_drop:    '⚠️',
  unplayable:     '🏔️',
  manual_penalty: '⚠️',
};
