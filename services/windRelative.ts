/**
 * WIND, RELATIVE TO THE SHOT — one owner for the only wind number that means anything.
 *
 * 2026-08-23. The app has always decomposed wind properly: queryStatusHandler took the shot bearing,
 * turned "from 270°" into head/tail/cross components and answered "11 into your face". The CADDIE
 * BRAIN was sent `windFromDeg: 270` and no bearing at all — so it could not possibly know whether
 * that wind was into the player, behind them, or across, and had two ways to fail. It either ignored
 * the wind entirely, or it guessed "into 16mph" and stated the guess as fact. Both were observed;
 * the guess is the worse one, because Tim's rule is that accuracy and truthfulness matter and a
 * confident wrong wind costs a club in the wrong direction.
 *
 * Three prompt rewrites failed to fix the club call in wind before anyone checked whether the brain
 * had the information to answer at all. It did not. [[connected-is-not-the-same-as-used]]
 *
 * This module is the single owner so the number the player HEARS and the number the caddie REASONS
 * from are the same number — two derivations of "which way is the wind" would eventually disagree,
 * and the player would be told one thing while the club was chosen from another.
 */
import { bearingDegrees } from '../utils/geoDistance';
import { getGreenCentroid, getTeeCentroid } from './shotLocationService';
// The MATHS lives in utils/ with no imports so the pure layer can reach it; this module owns the
// GEO half. Re-exported so every caller keeps one import site.
export { decomposeWind, type RelativeWind } from '../utils/windMath';

/** Tee → green bearing for a hole, or null when the hole has no mapped geometry. */
export function shotBearingDeg(hole: number): number | null {
  const tee = getTeeCentroid(hole);
  const green = getGreenCentroid(hole);
  if (tee && green) return bearingDegrees(tee, green);
  return null;
}
