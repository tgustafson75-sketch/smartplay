export type ShotOutcome =
  | 'clean'
  | 'water'
  | 'ob'
  | 'lost'
  | 'hazard_drop'
  | 'unplayable';

export const OUTCOME_LABELS: Record<ShotOutcome, string> = {
  clean:        'Clean',
  water:        'Water',
  ob:           'OB',
  lost:         'Lost',
  hazard_drop:  'Hazard',
  unplayable:   'Unplayable',
};

export const OUTCOME_EMOJI: Record<ShotOutcome, string> = {
  clean:        '●',
  water:        '🌊',
  ob:           '🚫',
  lost:         '🔍',
  hazard_drop:  '⚠️',
  unplayable:   '🏔️',
};
