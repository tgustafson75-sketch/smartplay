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

/**
 * The direction the player is ACTUALLY playing, in degrees.
 *
 * 2026-08-24 — was tee → green, always. That is right on the tee and wrong everywhere else: on a
 * dogleg, the line from the tee to the green is not the line of the second shot, so a headwind
 * could be reported as a crosswind for every shot after the drive. services/localStatusResponder
 * already used PLAYER → green for exactly this reason, which meant the spoken wind and the caddie's
 * wind could disagree on the same hole — the drift this module exists to prevent.
 *
 * Player → green whenever there is a live fix, tee → green as the fallback (no fix yet, or standing
 * on the tee), and null when the hole has no mapped geometry — an unknown bearing must stay unknown.
 */
export function shotBearingDeg(hole: number): number | null {
  const green = getGreenCentroid(hole);
  if (!green) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getLastFix } = require('./gpsManager') as typeof import('./gpsManager');
    const fix = getLastFix();
    if (fix && fix.lat != null && fix.lng != null) {
      return bearingDegrees({ lat: fix.lat, lng: fix.lng }, green);
    }
  } catch { /* no GPS module in this context — fall back to the card geometry */ }
  const tee = getTeeCentroid(hole);
  if (tee) return bearingDegrees(tee, green);
  return null;
}
