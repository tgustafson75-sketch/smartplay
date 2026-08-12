/**
 * 2026-08-12 — make the Preferred Tee setting mean something.
 *
 * Settings has offered Front / Middle / Back since the profile screen was built. The choice
 * persisted, rode along in the cloud backup, and was read by NOTHING: every course load took
 * `course.tees[0]` regardless. So a player who set "Front" was quoted the same yardages as one who
 * set "Back", and the caddie recommended clubs off them.
 *
 * That's a worse class of dead wiring than an unused internal field. The user can SEE this one, so
 * they believe they configured something — and the setting silently disagrees with every number the
 * app then tells them.
 *
 * Found by sweeping store fields for "written but never read". [[no-deferred-wiring-placeholders]]
 */

export type TeePreference = 'front' | 'middle' | 'back';

interface TeeLike {
  tee_name?: string;
  total_yards?: number;
}

/**
 * Pick the tee set matching the player's preference, by LENGTH rather than by name.
 *
 * Tee names are marketing ("Champion", "Player", "Heritage", colours, sometimes nothing at all) and
 * differ per course, so name-matching would work at one club and fail at the next. Length is the
 * thing the preference is actually about — front means the shortest set on the card.
 *
 * Returns the ORIGINAL array's element (not a copy) so callers can compare identity, and falls back
 * to the first entry whenever there's nothing to choose between — a course with one tee set, or
 * yardages the upstream didn't provide. Never returns undefined for a non-empty list.
 */
export function pickTeeSet<T extends TeeLike>(tees: T[] | null | undefined, preference: TeePreference): T | null {
  if (!tees || tees.length === 0) return null;
  if (tees.length === 1) return tees[0];

  // Only sets with a real total can be ordered. If fewer than two qualify there is no meaningful
  // choice to make, and guessing from names would be worse than honouring the upstream order.
  const measurable = tees.filter(t => typeof t.total_yards === 'number' && (t.total_yards as number) > 0);
  if (measurable.length < 2) return tees[0];

  const sorted = [...measurable].sort((a, b) => (a.total_yards as number) - (b.total_yards as number));
  if (preference === 'front') return sorted[0];
  if (preference === 'back') return sorted[sorted.length - 1];
  // Middle: the median set. For an even count this takes the shorter of the two central sets, which
  // is the kinder default — a player who hasn't thought about it shouldn't be handed the longer card.
  return sorted[Math.floor((sorted.length - 1) / 2)];
}
