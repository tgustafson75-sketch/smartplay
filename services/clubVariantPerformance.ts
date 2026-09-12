/**
 * 2026-09-12 (Tim) — WHICH OF HIS THREE DRIVERS IS ACTUALLY WORKING.
 *
 * "I have 3 drivers, all different shafts… that provides some degree of feedback data."
 *
 * DELIBERATELY NOT THE BALL COMPARISON, even though he asked for "the same logic". A ball is in play
 * for every shot of a round, so comparing ROUNDS by ball is sound (services/ballPerformance). A
 * driver shaft only touches the drives — comparing rounds by shaft would bury a real difference
 * under the day's putting. So this counts SHOTS, and only shots hit with the club in question.
 *
 * WHAT IT REPORTS, and why these two and not distance alone: a shaft that adds five yards and misses
 * two more fairways is a worse driver, and every golfer knows it. Distance on its own is the number
 * that sells clubs; it is not the number that lowers scores.
 *
 * THE HONESTY RULES — the same shape as the ball comparison, for the same reason:
 *  - a variant needs MIN_SHOTS before it is reported at all, and the comparison needs two of them.
 *  - "in trouble" counts what actually cost him: a penalty, or an outcome that was not clean.
 *  - a difference under the thresholds is reported as level, not as a winner. Telling someone to
 *    switch drivers on three yards and one fairway is fake precision.
 */
import type { ShotResult } from '../store/roundStore';
import { normalizeClub } from './clubNormalize';

/** Under this a couple of good swings decide it. */
export const MIN_SHOTS_PER_VARIANT = 12;

/** Yards of average carry/distance that count as a real difference. */
export const MEANINGFUL_YARDS = 6;

/** Percentage points of trouble rate that count as a real difference. */
export const MEANINGFUL_TROUBLE_PCT = 8;

export interface VariantSplit {
  variant: string;
  shots: number;
  /** Average logged distance in yards, or null when none of the shots carried a distance. */
  avgYards: number | null;
  /** Share of shots that ended in trouble or took a penalty, 0-100. */
  troublePct: number;
}

export interface VariantComparison {
  club: string;
  splits: VariantSplit[];
  say: string;
}

/** A shot that cost something: an explicit penalty, or an outcome that was not clean. */
function inTrouble(s: ShotResult): boolean {
  if ((s.penalty_strokes ?? 0) > 0) return true;
  const o = s.outcome;
  // Absent outcome is treated as clean — that is the documented meaning of old data in roundStore.
  return o != null && o !== 'clean';
}

/**
 * Compare the declared variants of ONE club across the player's shots.
 *
 * `club` is matched through normalizeClub, so "driver", "Driver" and "the big stick" all land on the
 * same slot rather than silently comparing nothing.
 */
export function compareClubVariants(shots: ShotResult[], club: string): VariantComparison {
  const want = normalizeClub(club);
  const buckets = new Map<string, { label: string; yards: number[]; trouble: number; total: number }>();

  for (const s of shots) {
    if (!s.club_variant) continue;
    if (!want || normalizeClub(s.club) !== want) continue;
    const key = s.club_variant.trim().toLowerCase();
    if (!key) continue;
    let b = buckets.get(key);
    if (!b) { b = { label: s.club_variant.trim(), yards: [], trouble: 0, total: 0 }; buckets.set(key, b); }
    b.total += 1;
    if (inTrouble(s)) b.trouble += 1;
    const y = s.distance_yards;
    if (typeof y === 'number' && y > 0) b.yards.push(y);
  }

  const splits: VariantSplit[] = [...buckets.values()]
    .filter((b) => b.total >= MIN_SHOTS_PER_VARIANT)
    .map((b) => ({
      variant: b.label,
      shots: b.total,
      avgYards: b.yards.length > 0 ? Math.round(b.yards.reduce((a, v) => a + v, 0) / b.yards.length) : null,
      troublePct: Math.round((b.trouble / b.total) * 100),
    }))
    .sort((a, b) => a.troublePct - b.troublePct);

  const label = want ?? club;

  if (splits.length < 2) {
    return {
      club: label,
      splits,
      say: buckets.size === 0
        ? `I have not got a ${label} tracked by model yet. Tell me which one you are putting in the bag and I will start counting.`
        : `I need about ${MIN_SHOTS_PER_VARIANT} shots with each ${label} before I compare them.`,
    };
  }

  const [a, b] = splits;
  const troubleGap = b.troublePct - a.troublePct;
  const yardGap = a.avgYards != null && b.avgYards != null ? a.avgYards - b.avgYards : null;

  /**
   * Straighter wins when the gap is real. Distance only decides it when they are equally straight,
   * because the fairway is worth more than the yards — and saying so is the honest caddie answer.
   */
  if (troubleGap >= MEANINGFUL_TROUBLE_PCT) {
    return {
      club: label,
      splits,
      say: `The ${a.variant}. You are in trouble off it ${a.troublePct}% of the time against ${b.troublePct}% with the ${b.variant}${
        yardGap != null && yardGap <= -MEANINGFUL_YARDS ? `, and yes it is about ${Math.abs(yardGap)} shorter — worth it` : ''
      }.`,
    };
  }

  if (yardGap != null && Math.abs(yardGap) >= MEANINGFUL_YARDS) {
    const longer = yardGap > 0 ? a : b;
    const other = yardGap > 0 ? b : a;
    return {
      club: label,
      splits,
      say: `About the same for trouble, so it comes down to distance: the ${longer.variant} is roughly ${Math.abs(yardGap)} yards longer than the ${other.variant}.`,
    };
  }

  return {
    club: label,
    splits,
    say: `Honestly, nothing in it — ${a.variant} and ${b.variant} are inside the noise on both distance and trouble. Play whichever you trust over the ball.`,
  };
}

/**
 * Find a club worth reporting on, across everything he has declared.
 *
 * The caddie payload cannot ask "compare my drivers" — it has to notice. This scans the clubs that
 * actually have two or more declared variants with enough shots, and returns the first comparison
 * that reached a CONCLUSION. A "nothing in it" result is deliberately not returned: it is the right
 * answer when asked, and noise when volunteered.
 */
export function bestClubVariantInsight(shots: ShotResult[]): VariantComparison | null {
  const clubs = new Set<string>();
  for (const s of shots) {
    if (!s.club_variant) continue;
    const c = normalizeClub(s.club);
    if (c) clubs.add(c);
  }
  for (const club of clubs) {
    const c = compareClubVariants(shots, club);
    if (c.splits.length >= 2 && !/nothing in it/i.test(c.say)) return c;
  }
  return null;
}
