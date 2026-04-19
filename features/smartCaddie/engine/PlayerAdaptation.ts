/**
 * features/smartCaddie/engine/PlayerAdaptation.ts
 *
 * Analyses the session shot log to detect a consistent club preference
 * and returns an integer adjustment offset for ClubEngine.
 *
 *   +1  → user consistently clubs UP   (recommend stronger club)
 *   -1  → user consistently clubs DOWN (recommend weaker club)
 *    0  → no clear preference yet
 *
 * Requires at least 5 logged shots before returning a non-zero adjustment.
 */

import { CLUBS } from '../types/club';
import type { ClubName } from '../types/club';
import type { TrackedShot } from '../hooks/useShotTracking';

/**
 * Returns +1, 0, or -1 based on whether the user tends to select a
 * stronger or weaker club than what was recommended.
 */
export function getClubAdjustment(shots: TrackedShot[]): number {
  if (shots.length < 5) return 0;

  const clubOrder = CLUBS as readonly ClubName[];
  let diffTotal = 0;

  for (const shot of shots) {
    const recIndex = clubOrder.indexOf(shot.recommended);
    const selIndex = clubOrder.indexOf(shot.selected);
    if (recIndex !== -1 && selIndex !== -1) {
      // Positive diff = user picked a club earlier in the list (stronger)
      diffTotal += recIndex - selIndex;
    }
  }

  const avgDiff = diffTotal / shots.length;

  if (avgDiff > 0.5)  return +1;  // user consistently clubs up
  if (avgDiff < -0.5) return -1;  // user consistently clubs down
  return 0;
}
