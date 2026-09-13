/**
 * A PUTT IS ALWAYS IN FEET. One owner for that rule.
 *
 * 2026-09-13 (Tim, reviewing the dashboard) — "putts should be always in Feet."
 *
 * The Highlights card read LONGEST PUTT 22y. Nobody has ever described a putt in yards. Worse, the
 * app was collecting them that way on purpose: `QuickLogShotSheet` offers `putter` in its club list
 * and then asks for "Distance (yards)", so a player logging a twenty-five-footer typed 25 and the
 * app recorded a seventy-five-foot putt. The Settings field for the personal best was labelled
 * "(yards)" and clamped at 1000 — a value three times longer than the longest putt ever holed on
 * tour would have passed without complaint.
 *
 * The conversion itself already had one owner, in services/simGame, put there on 2026-09-03 after a
 * `* 1.6` on the SwingSim screen reported every putt at half its length. That fix was right and its
 * home was wrong: FEET_PER_YARD is a fact about golf, not about the sim game, and the surfaces that
 * needed it most could not reach it without importing a shot engine. It moves here, unchanged, with
 * its test. [[two-owners-is-the-root-cause]] [[a-yard-is-three-feet]]
 *
 * WHICH UNIT LIVES WHERE, so this is never ambiguous again:
 *   - `ShotResult.distance_yards` means YARDS. For every club. It is the field's name and its
 *     contract, and the geometry (HoleShotMap) draws from it.
 *   - Every surface a HUMAN reads or types a putt on is FEET. Entry converts on the way in, display
 *     converts on the way out, and both go through this file.
 *   - `PlayerProfile.longestPuttFeet` is FEET, and says so in its name — because the one field that
 *     was only ever read by a human was the one that got this wrong.
 */

export const FEET_PER_YARD = 3;

/** Distance-to-pin in yards → the putt length in feet. Floored at a tap-in, never zero. */
export function puttFeetFrom(remainingYards: number): number {
  const y = Number.isFinite(remainingYards) ? Math.max(0, remainingYards) : 0;
  return Math.max(1, Math.round(y * FEET_PER_YARD));
}

/** Feet the player stated → the yards `distance_yards` stores. Two decimals, so ft→yd→ft is lossless. */
export function puttYardsFromFeet(feet: number): number {
  const f = Number.isFinite(feet) ? Math.max(0, feet) : 0;
  return Math.round((f / FEET_PER_YARD) * 100) / 100;
}

/**
 * The longest putt ever holed in a tournament is about 375 feet (Craig Barlow, 2008), and that was
 * across two tiers of one enormous green. 400 accepts any real putt and rejects the mis-keyed entry
 * this cap exists for — the old one let 1000 YARDS through.
 */
export const PUTT_MAX_FEET = 400;

/** True for the flat stick, whatever the surface happened to call it. The one spelling. */
export function isPutterClub(club: string | null | undefined): boolean {
  if (!club) return false;
  const c = club.trim().toLowerCase();
  return c === 'p' || c === 'putter' || c.includes('putter');
}

/**
 * How a logged shot's distance is shown. A putt reads in feet because that is how the player thinks
 * about it; everything else reads in yards. Returns null when there is no distance, so the caller
 * draws its dash rather than a "0".
 */
export function shotDistanceDisplay(
  club: string | null | undefined,
  distanceYards: number | null | undefined,
): { value: string; unit: 'yds' | 'ft' } | null {
  if (distanceYards == null || !Number.isFinite(distanceYards)) return null;
  if (isPutterClub(club)) return { value: String(puttFeetFrom(distanceYards)), unit: 'ft' };
  return { value: String(Math.round(distanceYards)), unit: 'yds' };
}
