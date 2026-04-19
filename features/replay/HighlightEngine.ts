/**
 * HighlightEngine
 *
 * Scores every shot in the round and returns the top N highlights.
 *
 * Scoring breakdown:
 *   • Distance:  long shots are intrinsically exciting
 *   • Accuracy:  center/on-target shots rewarded most
 *   • Approach:  80–180 yd shots carry approach weight
 *   • Short game: putts and chips with carried distance
 *   • Media bonus: shots with a linked video/photo get a boost
 *     so the reel can actually show something
 */

import type { Shot } from '../../store/roundStore';

export interface ScoredShot extends Shot {
  highlightScore: number;
}

export function scoreShot(shot: Shot): number {
  let score = 0;

  const dist = shot.gpsDistance ?? shot.distance ?? 0;

  // Distance excitement — caps at driver range (~300 yds)
  score += Math.min(dist, 300) * 0.2;

  // Accuracy bonus
  if (shot.result === 'center') score += 60;
  else if (shot.result === 'left' || shot.result === 'right') score += 10;
  // short/long = less exciting

  // Approach shots (80–180 yds = green-in-regulation territory)
  if (dist >= 80 && dist <= 180) score += 25;

  // Putt / short-game: club heuristic
  const clubLower = (shot.club ?? '').toLowerCase();
  if (clubLower.includes('putter') && dist > 10)  score += 35;
  if (clubLower.includes('sw') || clubLower.includes('lw')) score += 15;

  // Media bonus — if a video frame is attached the clip is displayable
  if (shot.frameTag) score += 40;

  return Math.round(score);
}

/**
 * Returns top `limit` shots sorted by highlight score (descending).
 * Pass `mediaOnly = true` to only include shots that have a video frame.
 */
export function getHighlights(
  shots: Shot[],
  limit = 5,
  mediaOnly = false,
): ScoredShot[] {
  let filtered = mediaOnly ? shots.filter((s) => !!s.frameTag) : shots;
  if (filtered.length === 0 && mediaOnly) filtered = shots; // fall back to all

  return filtered
    .map((s) => ({ ...s, highlightScore: scoreShot(s) }))
    .sort((a, b) => b.highlightScore - a.highlightScore)
    .slice(0, limit);
}
