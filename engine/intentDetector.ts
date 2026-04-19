/**
 * engine/intentDetector.ts
 *
 * Classifies a free-text query into one of four intent buckets.
 * Synchronous — no external calls.
 */

export type FocusIntent = 'golf' | 'utility' | 'service' | 'knowledge';

const GOLF_TOKENS = [
  'club', 'aim', 'hit', 'shot', 'swing', 'yardage', 'yards', 'iron',
  'driver', 'wedge', 'chip', 'putt', 'green', 'fairway', 'bunker',
  'rough', 'tee', 'pin', 'flag', 'birdie', 'bogey', 'par', 'eagle',
  'rule', 'penalty', 'hazard', 'ob', 'out of bounds', 'caddie',
  'what should i hit', 'what club', 'which club', 'how far',
];

const UTILITY_TOKENS = [
  'weather', 'wind', 'sunset', 'sunrise', 'temperature', 'rain',
  'forecast', 'dark', 'time', 'light', 'sun',
];

const SERVICE_TOKENS = [
  'food', 'drink', 'water', 'snack', 'eat', 'hungry',
  'restroom', 'bathroom', 'toilet', 'facilities',
  'clubhouse', 'pro shop', 'cart',
];

export const detectIntent = (query: string): FocusIntent => {
  const q = query.toLowerCase();

  if (GOLF_TOKENS.some((t) => q.includes(t))) return 'golf';
  if (UTILITY_TOKENS.some((t) => q.includes(t))) return 'utility';
  if (SERVICE_TOKENS.some((t) => q.includes(t))) return 'service';

  return 'knowledge';
};
