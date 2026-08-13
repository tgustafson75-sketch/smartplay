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

/**
 * 2026-08-12 (Tim's Arccos screenshot, after Wachusett) — CALIBRATE the chart to the player.
 *
 * His real bag against our defaults:
 *
 *   Driver 253 vs 245 (+8)   7i 163 vs 148 (+15)   PW 138 vs 110 (+28)
 *   9i     147 vs 122 (+25)  GW  128 vs  98 (+30)  SW 116 vs  86 (+30)
 *
 * Long clubs within a few yards; WEDGES OUT BY THIRTY. So before he logged anything, a 130-yard
 * shot got him a gap wedge — a club he actually hits 128, from a chart that thought it went 98.
 * That is the gap-wedge complaint he raised over and over, and the screenshot is where it came from.
 *
 * The per-club override already works once a club has data. The hole is the clubs that DON'T: they
 * sat on a generic chart while the player's own measured clubs proved the chart was wrong for him by
 * 20%. We had the evidence and ignored it for every club we hadn't seen.
 *
 * So: derive ONE scale factor from whatever the player has actually produced, and apply it to the
 * rest. Note this is NOT a driver-length scale — his driver is +3% while his wedges are +30%, so
 * scaling everything from the big stick would have fixed nothing. The ratio has to come from the
 * clubs themselves, whichever ones we happen to know.
 *
 * Conservative by construction: needs 2+ measured clubs, ignores the putter, clamps to 0.8-1.3x
 * (beyond that it's bad data, not a long hitter), and any club with real data still wins outright —
 * this only ever fills in the unknowns. [[self-growing-agent-architecture]]
 */
const MIN_CLUBS_TO_CALIBRATE = 2;
const SCALE_MIN = 0.8;
const SCALE_MAX = 1.3;

/**
 * The player's personal scale against the standard chart, or null when we can't honestly claim one.
 * `measured` maps club key → the player's real carry.
 */
export function personalBagScale(measured: Partial<Record<string, number>>): number | null {
  const ratios: number[] = [];
  for (const [club, yards] of Object.entries(measured ?? {})) {
    if (club === 'Putter' || typeof yards !== 'number' || yards <= 0) continue;
    const std = STANDARD_CARRY_YARDS[club as StandardClub];
    if (!std || std <= 0) continue;
    const r = yards / std;
    // A single implausible sample must not drag the whole bag — same discipline as the
    // club-distance plausibility band.
    if (r >= 0.5 && r <= 2) ratios.push(r);
  }
  if (ratios.length < MIN_CLUBS_TO_CALIBRATE) return null;
  // Median, not mean: one mis-attributed shot shouldn't move the factor.
  const sorted = [...ratios].sort((a, b) => a - b);
  const mid = sorted.length % 2
    ? sorted[(sorted.length - 1) / 2]
    : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  return Math.max(SCALE_MIN, Math.min(SCALE_MAX, mid));
}

/**
 * What this player should be assumed to carry `club`, given what they've actually produced.
 *
 * Real data wins. Otherwise the chart, scaled to them. Falls back to the raw chart when there isn't
 * enough evidence to scale — never invents a factor from one club.
 */
export function personalCarryFor(
  club: string | null | undefined,
  measured: Partial<Record<string, number>>,
): number | null {
  if (!club) return null;
  const own = measured?.[club];
  if (typeof own === 'number' && own > 0) return Math.round(own);
  const std = standardCarryFor(club);
  if (std == null) return null;
  const scale = personalBagScale(measured);
  return scale == null ? std : Math.round(std * scale);
}
