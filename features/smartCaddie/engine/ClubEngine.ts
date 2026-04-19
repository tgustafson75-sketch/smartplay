/**
 * features/smartCaddie/engine/ClubEngine.ts
 *
 * Pure distance → club recommendation with optional player adjustment.
 * Thresholds represent the upper carry distance for each club at an
 * average amateur level. No React dependencies — safe to call anywhere.
 */

import { CLUBS } from '../types/club';
import type { ClubName } from '../types/club';

/** Shifts a club along the ordered list by `shift` positions.
 *  Positive shift = stronger club (lower index); clamped to list bounds. */
function shiftClub(club: ClubName, shift: number): ClubName {
  const index    = (CLUBS as readonly ClubName[]).indexOf(club);
  const newIndex = Math.max(0, Math.min(CLUBS.length - 1, index - shift));
  return CLUBS[newIndex] as ClubName;
}

/**
 * Applies a fractional club-bias (from PlayerLearning.buildPlayerModel) to a
 * base club recommendation. Rounds the bias to the nearest integer shift.
 *
 * @param club  The base recommended club
 * @param bias  Fractional shift — positive = take stronger club
 */
export function adjustClub(club: ClubName, bias: number): ClubName {
  const rounded = Math.round(bias);
  return rounded !== 0 ? shiftClub(club, rounded) : club;
}

/**
 * Returns the recommended club for the given distance in yards.
 *
 * @param distance   Yardage to the target (green center).
 * @param adjustment Optional offset from PlayerAdaptation (+1 = clubs up, -1 = clubs down).
 */
export function recommendClub(distance: number, adjustment = 0): ClubName {
  let club: ClubName;

  if (distance > 240) club = 'Driver';
  else if (distance > 220) club = '3W';
  else if (distance > 200) club = '5W';
  else if (distance > 185) club = '4H';
  else if (distance > 170) club = '5I';
  else if (distance > 160) club = '6I';
  else if (distance > 150) club = '7I';
  else if (distance > 140) club = '8I';
  else if (distance > 125) club = '9I';
  else if (distance > 110) club = 'PW';
  else if (distance > 95)  club = 'GW';
  else if (distance > 80)  club = 'SW';
  else                     club = 'LW';

  return adjustment !== 0 ? shiftClub(club, adjustment) : club;
}

