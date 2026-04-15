/**
 * patternEngine.js
 *
 * Lightweight signal engine for the AI Caddie.
 * Keeps pattern logic isolated so the play screen stays fast and readable.
 */

export const getAdvancedPatterns = (shots = []) => {
  if (!shots || shots.length < 5) {
    return {
      missBias: null,
      pressureBias: null,
    };
  }

  let left = 0;
  let right = 0;
  let recentRight = 0;
  let recentLeft = 0;

  shots.forEach((shot, i) => {
    if (shot.result === 'left') left++;
    if (shot.result === 'right') right++;

    // Last 3 shots weighting
    if (i >= shots.length - 3) {
      if (shot.result === 'right') recentRight++;
      if (shot.result === 'left') recentLeft++;
    }
  });

  return {
    missBias:
      right >= left + 2 ? 'right' :
      left >= right + 2 ? 'left' : null,

    pressureBias:
      recentRight >= 2 ? 'right' :
      recentLeft >= 2 ? 'left' : null,
  };
};
