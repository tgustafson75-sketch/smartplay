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
export function pickTeeSet<T extends TeeLike>(
  tees: T[] | null | undefined,
  preference: TeePreference,
  gender?: 'm' | 'f' | 'x' | null,
): T | null {
  if (!tees || tees.length === 0) return null;
  if (tees.length === 1) return tees[0];

  /**
   * 2026-08-21 — PICK THE RIGHT PLAYER'S RATING FIRST, then the right length.
   *
   * Found building Sharp Park (Pacifica) end to end. golfcourseapi returns male and female tee sets
   * separately, and they share yardages: Blue is 6416y at 77.5/135 for women and 71.2/125 for men.
   * Ordering by yardage alone makes those a TIE, and a tie resolves to whichever the API listed
   * first — the women's set. The holes were right and the course rating belonged to someone else.
   *
   * Course handicap is (Index × Slope/113) + (Rating − Par), so that is wrong net scoring and a
   * wrong posting, silently, on a real course.
   *
   * When the player's gender is UNKNOWN we do NOT guess: mixing two rating sets is what caused
   * this, so we collapse to a single consistent group rather than pick a gender. Deduping by
   * yardage keeps one entry per physical tee, so "back/middle/front" still means what it says.
   */
  const want = gender === 'm' ? 'male' : gender === 'f' ? 'female' : null;
  let pool = tees;
  if (want) {
    const matching = tees.filter(t => (t as { gender?: string | null }).gender === want);
    if (matching.length > 0) pool = matching;
  } else if (tees.some(t => (t as { gender?: string | null }).gender)) {
    // Unknown player, gendered data: keep ONE set per distinct yardage so the ratings stay internally
    // consistent instead of silently interleaving two scorecards.
    const seen = new Set<number>();
    pool = tees.filter(t => {
      const y = typeof t.total_yards === 'number' ? t.total_yards : -1;
      if (seen.has(y)) return false;
      seen.add(y);
      return true;
    });
  }
  tees = pool;
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

/**
 * 2026-08-22 — THE TEE THE PLAYER ACTUALLY PLAYS, resolved in exactly one place.
 *
 * Found building Sharp Park (Pacifica) through the real user path. `courseToHoles(course, teeName?)`
 * has taken a tee name since 08-19, and its "that tee isn't on this card" fallback was carefully
 * written and logged — but ALL FOUR call sites pass nothing:
 *
 *     app/course-layout.tsx · app/(tabs)/caddie.tsx (x2) · services/courseDownloadEngine.ts
 *
 * So every one of them fell through to `course.tees[0]`, which is the longest set on the card and,
 * on a course rated for both, the women's copy of it. At Sharp Park that hands a Gold-tee player the
 * BLUE card everywhere: 6416 yards instead of 5087, and hole 5 quoted as 195 when they are hitting
 * 145. The caddie then recommends a club off that number. The parameter was right, the fallback was
 * right, and nothing ever asked — the same shape as "Preferred Tee did nothing" on 08-12, one layer
 * down. [[no-deferred-wiring-placeholders]] [[no-half-fixes-enforce-every-surface]]
 *
 * Reads the profile itself rather than making every caller remember two settings, and is applied
 * INSIDE courseToHoles/courseSummaryForContext so no call site has to opt in -- opting in is the
 * step that never happened last time.
 *
 * Returns the tee OBJECT, never its name. Sharp Park lists "Blue" twice -- once in each rating set,
 * same 6416 yards, 77.5/135 against 71.2/125 -- so a name is not enough to say which one, and
 * resolving to "Blue" would quietly undo the gender fix one line later.
 */
export function playerTee<T extends TeeLike>(course: { tees?: T[] | null } | null | undefined): T | null {
  if (!course?.tees?.length) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const store = require('../store/playerProfileStore').usePlayerProfileStore.getState();
    return pickTeeSet(course.tees, store.preferredTee ?? 'middle', store.handicap_gender ?? 'x');
  } catch {
    // A profile that won't load must not take the course down with it.
    return null;
  }
}
