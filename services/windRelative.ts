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

export interface RelativeWind {
  /** Along the shot line. NEGATIVE = into the player's face, POSITIVE = at their back. */
  alongMph: number;
  /** Across the shot line. POSITIVE = blowing from the left, NEGATIVE = from the right. */
  crossMph: number;
  /** Which component dominates — what the player actually needs to hear. */
  kind: 'into' | 'behind' | 'cross';
  /** The spoken phrase, e.g. "11 into your face". Kept here so voice and brain never drift apart. */
  phrase: string;
}

/** Tee → green bearing for a hole, or null when the hole has no mapped geometry. */
export function shotBearingDeg(hole: number): number | null {
  const tee = getTeeCentroid(hole);
  const green = getGreenCentroid(hole);
  if (tee && green) return bearingDegrees(tee, green);
  return null;
}

/**
 * Decompose a meteorological wind (the direction it blows FROM) against the shot line.
 * Returns null when either input is missing — an unknown wind must stay unknown rather than
 * defaulting to "into", which is the assumption that makes a caddie sound certain and be wrong.
 */
export function decomposeWind(
  windFromDeg: number | null | undefined,
  windMph: number | null | undefined,
  bearingDeg: number | null | undefined,
): RelativeWind | null {
  if (windFromDeg == null || !Number.isFinite(windFromDeg)) return null;
  if (windMph == null || !Number.isFinite(windMph)) return null;
  if (bearingDeg == null || !Number.isFinite(bearingDeg)) return null;

  const windTo = (windFromDeg + 180) % 360;
  let rel = windTo - bearingDeg;
  rel = ((rel + 540) % 360) - 180;
  const alongMph = Math.cos((rel * Math.PI) / 180) * windMph;
  const crossMph = Math.sin((rel * Math.PI) / 180) * windMph;

  const alongDominates = Math.abs(alongMph) > Math.abs(crossMph) * 1.5;
  const kind: RelativeWind['kind'] = alongDominates ? (alongMph < 0 ? 'into' : 'behind') : 'cross';
  const phrase = alongDominates
    ? alongMph < 0
      ? `${Math.round(Math.abs(alongMph))} into your face`
      : `${Math.round(alongMph)} at your back`
    : `${Math.round(Math.abs(crossMph))} crosswind from the ${crossMph > 0 ? 'left' : 'right'}`;

  return { alongMph, crossMph, kind, phrase };
}
