/**
 * 2026-09-12 (Tim) — "Longest drive is on the dashboard and GIR is calculated on the scorecard."
 *
 * He was correcting a claim I had relayed without checking: that the caddie had NO source for GIR or
 * longest-drive history, and so the off-round deflection could not be opened for them. Both sources
 * exist and both are persisted. GIR is derived from score − putts against par, from values
 * `compactHistoryForPersist` explicitly preserves for every round it keeps (scores, putts, holePars);
 * longest drive is a `playerProfileStore` field that logShot updates whenever a driver beats the
 * record, which is exactly what the dashboard highlights card reads.
 *
 * So `queryStatusHandler` was answering "You're not in a round yet. Want to start one?" to questions
 * it could answer from data already on the phone. [[trust-the-users-lived-reality]]
 *
 * THESE FORMULAS HAD ONE CALLER AND NOW HAVE TWO — the live round and the last completed one — which
 * is the whole reason they are here rather than copied. A second copy of "what counts as a green in
 * regulation" would drift from the scorecard's, and the two would answer the same question
 * differently depending on whether he was standing on a fairway. [[two-owners-is-the-root-cause]]
 */

export interface ScoredRound {
  scores: Record<number, number>;
  putts: Record<number, number>;
  /** Par for a hole, or null when genuinely unknown — never a 4 stood in for a missing value. */
  parOf: (hole: number) => number | null;
}

/**
 * Greens in regulation, derived honestly: strokes-to-green is the hole score minus putts, and the
 * green was hit in regulation when that is at most par − 2. Counts ONLY holes where score, putts and
 * par are all known — a hole with no putts logged cannot be derived, so it is skipped rather than
 * guessed. Unchanged from the scorecard's own rule; this is that rule, moved.
 */
export function girFrom(r: ScoredRound): { hit: number; counted: number } {
  let counted = 0, hit = 0;
  for (const hStr of Object.keys(r.scores ?? {})) {
    const h = Number(hStr);
    const score = r.scores[h];
    const putts = r.putts?.[h];
    const par = r.parOf(h);
    if (!(score > 0) || typeof putts !== 'number' || par == null) continue;
    counted++;
    if ((score - putts) <= (par - 2)) hit++;
  }
  return { hit, counted };
}

export function puttStatsFrom(r: ScoredRound): {
  holes: number; total: number; threePutts: number; onePutts: number; avg: number | null;
} {
  const holes = Object.keys(r.putts ?? {}).map(Number).filter((h) => Number.isFinite(h));
  let total = 0, threePutts = 0, onePutts = 0;
  for (const h of holes) {
    const p = r.putts[h];
    if (typeof p !== 'number') continue;
    total += p;
    if (p >= 3) threePutts++;
    if (p === 1) onePutts++;
  }
  return { holes: holes.length, total, threePutts, onePutts, avg: holes.length > 0 ? total / holes.length : null };
}

export function nineSplitFrom(r: ScoredRound, lo: number, hi: number): {
  strokes: number; parSum: number; played: number; vs: number | null;
} {
  let strokes = 0, parSum = 0, played = 0;
  for (let h = lo; h <= hi; h++) {
    const s = r.scores?.[h];
    if (!(s > 0)) continue;
    played++;
    strokes += s;
    const par = r.parOf(h);
    if (par != null) parSum += par;
  }
  return { strokes, parSum, played, vs: parSum > 0 ? strokes - parSum : null };
}

/**
 * A completed round read as a ScoredRound. Par comes from the round's OWN stored `holePars`, not from
 * the course currently loaded — asking about last week's round while standing on a different course
 * would otherwise score it against this course's pars.
 */
export function scoredRoundFromRecord(rec: {
  scores?: Record<number, number> | null;
  putts?: Record<number, number> | null;
  holePars?: Record<number, number> | null;
}): ScoredRound {
  const pars = rec.holePars ?? {};
  return {
    scores: rec.scores ?? {},
    putts: rec.putts ?? {},
    parOf: (h) => (typeof pars[h] === 'number' ? pars[h] : null),
  };
}

/**
 * 2026-09-12 — LONGEST DRIVE, the number the dashboard's highlights card shows.
 *
 * Tim: "Longest drive is on the dashboard." It is, and it was derived inside `app/(tabs)/dashboard`
 * with that screen as its only reader, so the caddie could not quote the figure the player was
 * looking at. Moved here unchanged so both read one rule.
 *
 * THE 500-YARD CAP IS NOT TIDINESS. 2026-06-30, Tim saw a ~7000-yard "longest drive": a failed
 * capture leaked the whole course's yardage into a shot. No human drive exceeds ~500y, so anything
 * above that is a corrupt capture and is dropped — which also self-heals a bad stored value rather
 * than enshrining it.
 */
export const MAX_REAL_DRIVE = 500;

export function longestDriveFrom(input: {
  rounds?: readonly { shots?: readonly { club?: string | null; carry_distance?: number | null; distance_yards?: number | null; gps_distance_yards?: number | null }[] | null }[] | null;
  profileLongestDrive?: number | null;
}): number | null {
  const fromHistory = (input.rounds ?? [])
    .flatMap((r) => (r.shots ?? []) as readonly { club?: string | null; carry_distance?: number | null; distance_yards?: number | null; gps_distance_yards?: number | null }[])
    .filter((sh) => sh.club === 'Driver')
    .map((sh) => sh.carry_distance ?? sh.distance_yards ?? 0)
    .filter((y) => typeof y === 'number' && y > 0 && y <= MAX_REAL_DRIVE)
    .reduce((max: number, y: number) => (y > max ? y : max), 0);
  const p = input.profileLongestDrive;
  const fromProfile = (typeof p === 'number' && p > 0 && p <= MAX_REAL_DRIVE) ? p : 0;
  const best = Math.max(fromHistory, fromProfile);
  return best > 0 ? Math.round(best) : null;
}
