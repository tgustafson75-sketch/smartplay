/**
 * The wind decomposition — PURE maths, no imports, so it can be reached from anywhere.
 *
 * 2026-08-23. This started life in three places at once: queryStatusHandler (for the spoken "11 into
 * your face"), utils/playsLike (for the yardage adjustment), and nowhere at all for the caddie
 * brain, which was handed a raw compass degree and could not tell a headwind from a tailwind.
 *
 * It lives in utils/ and imports NOTHING on purpose. The first attempt put it in services/ beside
 * the tee→green lookup, which pulled react-native into utils/playsLike through the import chain and
 * broke the invariant simulation — a pure calculation must stay reachable from the pure layer.
 * services/windRelative owns the GEO half (which way is this hole pointing); this owns the MATHS.
 */

export interface RelativeWind {
  /** Along the shot line. NEGATIVE = into the player's face, POSITIVE = at their back. */
  alongMph: number;
  /** Across the shot line. POSITIVE = from the left, NEGATIVE = from the right. */
  crossMph: number;
  kind: 'into' | 'behind' | 'cross';
  /** Spoken phrase, e.g. "11 into your face" — here so voice and brain never drift apart. */
  phrase: string;
}

/**
 * Decompose a meteorological wind (the direction it blows FROM) against the shot line.
 * Null when anything is missing: an unknown wind must stay unknown rather than defaulting to
 * "into", which is the assumption that makes a caddie sound certain and be wrong.
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
