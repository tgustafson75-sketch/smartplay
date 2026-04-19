/**
 * personalities.ts
 *
 * Caddie personality definitions.
 * Logic is never changed — only the tone of the trailing phrase differs.
 *
 * applyPersonality() appends a personality-flavored closing to any advice string.
 * Closings rotate deterministically based on string hash so the same advice
 * always sounds slightly different across holes without being random on re-render.
 */

export type CaddiePersonality = 'calm' | 'aggressive' | 'coach';

// ─────────────────────────────────────────────────────────────────────────────
// Personality definitions
// ─────────────────────────────────────────────────────────────────────────────

export const PERSONALITIES: Record<
  CaddiePersonality,
  { name: string; description: string; closings: string[] }
> = {
  calm: {
    name: 'Calm Pro',
    description: 'Steady, measured. Keeps you grounded',
    closings: [
      'Nice and smooth.',
      'Stay in your tempo.',
      'Breathe and commit.',
      'Easy does it.',
      'Quiet mind, good swing.',
    ],
  },
  aggressive: {
    name: 'Aggressive',
    description: 'Bold, decisive. Attacks every shot',
    closings: [
      'Go after it.',
      'Attack — trust it.',
      'Be decisive.',
      'Commit hard.',
      'No hesitation.',
    ],
  },
  coach: {
    name: 'Coach',
    description: 'Encouraging, positive. Builds confidence',
    closings: [
      'You\'ve got this.',
      'Trust your process.',
      'Keep that tempo — great work.',
      'Stay committed — good things happen.',
      'Believe in your swing.',
    ],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Score-aware (post-hole) phrasing by personality
// ─────────────────────────────────────────────────────────────────────────────

type ScoreDiff = 'eagle' | 'birdie' | 'par' | 'bogey' | 'double' | 'worse';

const SCORE_PHRASES: Record<CaddiePersonality, Record<ScoreDiff, string>> = {
  calm: {
    eagle:  'Eagle. Stay in the moment — keep your process.',
    birdie: 'Birdie. Commit to the next shot and stay smooth.',
    par:    'Solid par. Stay focused on the next tee.',
    bogey:  'Reset. Play center green from here.',
    double: 'Take your medicine — fairway first, green next.',
    worse:  'Stay patient. One shot at a time.',
  },
  aggressive: {
    eagle:  'Eagle. You\'re locked in — keep attacking.',
    birdie: 'Birdie. Momentum is yours — press it.',
    par:    'Par. Fine — now go hunt the next one.',
    bogey:  'Shake it off. Attack from the tee next hole.',
    double: 'Forget it. Bold play from here.',
    worse:  'Next shot is all that matters. Attack.',
  },
  coach: {
    eagle:  'Eagle! Outstanding — stay in your groove.',
    birdie: 'Birdie! Great swing — keep that feeling.',
    par:    'Nice par. Solid process — you\'re doing great.',
    bogey:  'Good adjustment. Stay positive — you\'ve got this.',
    double: 'Stay confident. Every great player has these — bounce back.',
    worse:  'Keep your head up. Commit to the next one — you\'ve got it.',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Simple deterministic hash so the same advice always picks the same closing. */
function _hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * Appends a personality-flavored closing phrase to any advice string.
 * If personality is not set or unknown, returns `advice` unchanged.
 */
export function applyPersonality(advice: string, personality: CaddiePersonality | null | undefined): string {
  if (!personality) return advice;
  const def = PERSONALITIES[personality];
  if (!def) return advice;
  const closing = def.closings[_hash(advice) % def.closings.length]!;
  // Avoid doubling if the closing is already part of the advice
  if (advice.endsWith(closing)) return advice;
  return `${advice} ${closing}`;
}

/**
 * Returns score-aware advice string for the given diff + personality.
 * diff = score − par
 */
export function scoreAdvice(diff: number, personality: CaddiePersonality | null | undefined): string {
  const p: CaddiePersonality = personality ?? 'calm';
  const phrases = SCORE_PHRASES[p];
  if (diff < -1) return phrases.eagle;
  if (diff === -1) return phrases.birdie;
  if (diff === 0)  return phrases.par;
  if (diff === 1)  return phrases.bogey;
  if (diff === 2)  return phrases.double;
  return phrases.worse;
}
