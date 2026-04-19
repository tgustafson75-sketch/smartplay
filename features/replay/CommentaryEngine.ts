/**
 * CommentaryEngine
 *
 * Generates a short, natural-sounding highlight commentary line for a shot.
 * Phrases are randomised within result/context buckets to avoid repetition.
 * All lines are designed to speak in < 3 seconds at rate 0.95.
 */

import type { ScoredShot } from './HighlightEngine';

// ── Phrase pool helpers ───────────────────────────────────────────────────────
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── Phrase banks ──────────────────────────────────────────────────────────────
const LONG_GOOD = [
  'Absolutely crushed.',
  'That is a bomb.',
  'Big, big shot.',
  'Pure ball striking right there.',
  'That one had serious heat on it.',
];

const SHORT_GOOD = [
  'Dialed in. Right at the flag.',
  'Tucked away nicely.',
  'That is tracking perfectly.',
  'Thread the needle.',
  'Laser. Perfect number.',
];

const PUTT_GOOD = [
  'Great read. That drops.',
  'Never in doubt.',
  'Pure. Right in the heart.',
  'Reads it perfectly.',
];

const PUTT_MISS = [
  'Lips it out.',
  'Just missed the break.',
  'Left it short of the hole.',
];

const RESULT_RIGHT = [
  'Just leaking right.',
  'Faded a touch off line.',
  'A little push, but workable.',
  'Slid right at the last second.',
];

const RESULT_LEFT = [
  'Pulled slightly left.',
  'Hooked a fraction.',
  'Missed the target left, but close.',
  'A touch left of the line.',
];

const RESULT_SHORT = [
  'Came up just a little short.',
  'Not quite carrying the full number.',
  'Landed short of the target.',
];

const RESULT_LONG = [
  'Flew right through the back.',
  'Too much club on that one.',
  'Long and left to work with.',
];

const GENERIC = [
  'Solid strike.',
  'Good swing. Good contact.',
  'Well executed.',
  'That will play.',
];

// ── Main generator ────────────────────────────────────────────────────────────
export function generateCommentary(shot: ScoredShot): string {
  if (!shot) return pick(GENERIC);

  const dist     = shot.gpsDistance ?? shot.distance ?? 0;
  const result   = shot.result;
  const clubLow  = (shot.club ?? '').toLowerCase();
  const isPutt   = clubLow.includes('putter');

  // Putt handling
  if (isPutt) {
    if (result === 'center') return pick(PUTT_GOOD);
    return pick(PUTT_MISS);
  }

  // Directional misses
  if (result === 'right') return pick(RESULT_RIGHT);
  if (result === 'left')  return pick(RESULT_LEFT);
  if (result === 'short') return pick(RESULT_SHORT);
  if (result === 'long')  return pick(RESULT_LONG);

  // Center / on-target — split by distance
  if (result === 'center') {
    return dist >= 180 ? pick(LONG_GOOD) : pick(SHORT_GOOD);
  }

  return pick(GENERIC);
}
