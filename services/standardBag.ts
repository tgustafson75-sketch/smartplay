/**
 * 2026-08-12 — THE standard bag. One table, every consumer.
 *
 * Tim: "Make sure SmartMotion planned distance also correlates to the player's bag and/or
 * verified/played distances."
 *
 * It didn't, because the app carried THREE independent standard-yardage tables and they disagreed:
 *
 *                        clubStatsStore   cnsShotRead    equipment_intelligence
 *   Driver                    245             250                 230
 *   7 iron                    148             155                 150
 *   GW                         98             100                  95
 *
 * and SmartMotion then scaled the third one by a handicap factor (0.86 at 18), so a player with no
 * logged data was told by the caddie that his driver goes 250 and by the swing card that he just
 * carried 198. Same club, same player, same session, a 52-yard disagreement — and nothing in the
 * code was wrong on its own, which is exactly why it survived.
 *
 * Tim, earlier and bluntly: "We know a standard golf yardage bag, and we use that as the default if
 * we don't have an updated user-specific one." So: this file is that bag. Learned/verified player
 * distances still override it club by club — that is the whole point of measuring — but where we
 * have no data for a player, every surface now quotes the SAME number.
 *
 * Values are CARRY in yards for a full swing. ROLL_YARDS carries the extra distance a shot runs out
 * after landing, so a "total" ladder can be derived without a second table drifting away from this
 * one. [[no-half-fixes-enforce-every-surface]] [[club-logic-unified-2026-07-24]]
 */

export type StandardClub =
  | 'Driver' | '3W' | '5W' | '7W'
  | '2H' | '3H' | '4H' | '5H'
  | '3I' | '4I' | '5I' | '6I' | '7I' | '8I' | '9I'
  | 'PW' | 'AW' | 'GW' | 'SW' | 'LW' | 'Putter';

/** Full-swing CARRY, yards. The single default when a player has no measured distance. */
export const STANDARD_CARRY_YARDS: Record<StandardClub, number> = {
  Driver: 245, '3W': 233, '5W': 223, '7W': 213,
  '2H': 215, '3H': 210, '4H': 197, '5H': 183,
  '3I': 205, '4I': 190, '5I': 175, '6I': 162, '7I': 148, '8I': 135, '9I': 122,
  PW: 110, AW: 104, GW: 98, SW: 86, LW: 74, Putter: 0,
};

/** Yards a shot runs after landing. total = carry + roll. Keeps the two ladders from drifting. */
export const ROLL_YARDS: Record<StandardClub, number> = {
  Driver: 28, '3W': 22, '5W': 19, '7W': 17, '2H': 16, '3H': 15, '4H': 13, '5H': 12,
  '3I': 12, '4I': 10, '5I': 9, '6I': 8, '7I': 6, '8I': 5, '9I': 5,
  PW: 4, AW: 4, GW: 4, SW: 3, LW: 2, Putter: 0,
};

/**
 * Readable label for each club — what the caddie SAYS. Never speak a store key ('7I') at a player.
 * Several store keys collapse onto one spoken label (every hybrid is "Hybrid"), which is why the
 * spoken ladder is derived rather than hand-listed: a hand-listed copy is how the duplicate-club
 * bug got in ('7I' 165 sitting beside '7 Iron' 155 in the same ladder).
 */
export const CLUB_LABEL: Record<StandardClub, string> = {
  Driver: 'Driver', '3W': '3 Wood', '5W': '5 Wood', '7W': '7 Wood',
  '2H': 'Hybrid', '3H': 'Hybrid', '4H': 'Hybrid', '5H': 'Hybrid',
  '3I': '3 Iron', '4I': '4 Iron', '5I': '5 Iron', '6I': '6 Iron',
  '7I': '7 Iron', '8I': '8 Iron', '9I': '9 Iron',
  PW: 'PW', AW: 'AW', GW: 'GW', SW: 'SW', LW: 'LW', Putter: 'Putter',
};

/**
 * The spoken ladder: [label, carry] longest-first, one entry per LABEL. Where several clubs share a
 * label (the hybrids) the longest wins, so the ladder stays strictly descending and a player is
 * never offered the same-sounding club twice.
 */
export const STANDARD_LADDER: readonly (readonly [string, number])[] = (() => {
  const byLabel = new Map<string, number>();
  for (const club of Object.keys(STANDARD_CARRY_YARDS) as StandardClub[]) {
    if (club === 'Putter') continue;
    const label = CLUB_LABEL[club];
    const carry = STANDARD_CARRY_YARDS[club];
    if (!byLabel.has(label) || carry > byLabel.get(label)!) byLabel.set(label, carry);
  }
  return [...byLabel.entries()].sort((a, b) => b[1] - a[1]).map(([l, y]) => [l, y] as const);
})();

/** Carry for a club, or null when we have no opinion (unknown club / putter). */
export function standardCarryFor(club: string | null | undefined): number | null {
  if (!club) return null;
  const y = STANDARD_CARRY_YARDS[club as StandardClub];
  return typeof y === 'number' && y > 0 ? y : null;
}
