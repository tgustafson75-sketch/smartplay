/**
 * DID MY OWN ADVICE WORK? — the missing LEARN step.
 *
 * 2026-08-21. Tracing the intelligence loop end to end found it severed at exactly one joint.
 * Advice is recorded (pendingKevinRec → kevin_rec_club), the outcome is recorded (the shot), and the
 * two are paired (kevin_adhered). Then the ONLY consumer in the entire app is recapGenerator, which
 * computes an adherence RATE — "what percentage of my advice did you take" — and prints it in a
 * post-round summary.
 *
 * That measures the PLAYER'S COMPLIANCE. It says nothing about whether the advice was any good.
 * Nothing anywhere asked the question a real caddie asks after every shot: was that the right club?
 *
 * So the player model learned the player (clubTendency → distances, shape, miss side) while the
 * caddie never learned ITSELF. It has been giving advice for months with no feedback path — which
 * is the difference between a system that ACCUMULATES intelligence and one that merely performs it.
 *
 * ─── THE RULE THAT MAKES THIS HONEST ───────────────────────────────────────────────────────────
 *
 * A good decision can produce a bad result. If the player chunks a 7-iron, that tells you nothing
 * about whether 7-iron was the right call — it tells you about the strike. Judging the club call by
 * that shot would teach the caddie to chase outcomes, and would eventually make it recommend clubs
 * that flatter a player's misses instead of clubs that are correct.
 *
 * So a shot only TESTS THE DECISION when three things hold:
 *   1. the caddie actually advised a club,
 *   2. the player took that club (otherwise a different decision was executed), and
 *   3. the strike was CLEAN — flush / solid / pure.
 *
 * Everything else is evidence about execution, and belongs to the practice side of the product, not
 * to the question of whether the caddie is calling the right club.
 *
 * Pure and dependency-injected for the same reason clubTendency is: it must be testable without a
 * store, and club names arrive in several vocabularies that MUST collapse to one key.
 */

export type AdviceShot = {
  club?: string | null;
  kevin_rec_club?: string | null;
  kevin_adhered?: boolean | null;
  feel?: 'flush' | 'solid' | 'fat' | 'thin' | 'heel' | 'toe' | 'pure' | 'topped' | null;
  direction?: 'left' | 'straight' | 'right' | null;
  distance_yards?: number | null;
  carry_distance?: number | null;
  gps_distance_yards?: number | null;
};

export type AdviceOutcome = {
  club: string;
  /** Clean strikes on a club the caddie called and the player took. The only decision evidence. */
  n: number;
  /** Median measured distance across those strikes, or null when nothing was measured. */
  playedYds: number | null;
  /** What the bag says this club goes. The gap between the two is the caddie's calibration error. */
  expectedYds: number | null;
  /** playedYds - expectedYds, rounded. Negative = the caddie has been under-clubbing this player. */
  deltaYds: number | null;
  /** Dominant miss side on clean, advised strikes — an AIM error, not a strike error. */
  missSide: 'left' | 'right' | null;
  missShare: number;
};

/** A clean strike is the only one that tests the DECISION rather than the swing. */
/**
 * What counts as a CLEAN STRIKE, app-wide. Exported 2026-08-24 so
 * services/practice/routineImpact consumes this set rather than declaring a second one — two
 * definitions of "did he catch it" is how the club label map and the carry bag went wrong.
 */
export const CLEAN_CONTACT = new Set(['flush', 'solid', 'pure']);

/**
 * Below this we say nothing at all. Three clean strikes on one club is a rumour, not a pattern, and
 * a confident sentence built on it would change club calls for a player whose real distance we do
 * not yet know. Same discipline as describeClubTendency: an empty line beats a wrong one.
 */
const MIN_DECISION_SHOTS = 4;
/** A miss side has to actually dominate before it is worth an aim adjustment. */
const DOMINANT_SHARE = 0.6;
/** Below this the caddie is calling the right club and there is nothing to report. */
export const MEANINGFUL_DELTA_YDS = 6;

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/** The most trustworthy distance we have for a shot, in preference order. */
function measuredYds(s: AdviceShot): number | null {
  for (const v of [s.gps_distance_yards, s.carry_distance, s.distance_yards]) {
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
  }
  return null;
}

export function adviceOutcomes(
  shots: AdviceShot[] | null | undefined,
  expectedFor: (club: string) => number | null,
  normalize: (raw: string | null | undefined) => string | null,
): AdviceOutcome[] {
  const byClub = new Map<string, AdviceShot[]>();
  for (const s of shots ?? []) {
    if (!s) continue;
    // The caddie must have actually made a call, and the player must have played it.
    if (s.kevin_adhered !== true) continue;
    const advised = normalize(s.kevin_rec_club ?? null);
    if (!advised) continue;
    // Execution error is not decision error. This single line is what keeps the caddie from
    // learning to recommend clubs that flatter bad strikes.
    if (!s.feel || !CLEAN_CONTACT.has(s.feel)) continue;
    const arr = byClub.get(advised);
    if (arr) arr.push(s); else byClub.set(advised, [s]);
  }

  const out: AdviceOutcome[] = [];
  for (const [club, list] of byClub) {
    const played = median(list.map(measuredYds).filter((v): v is number => v != null));
    const expected = expectedFor(club);
    const missCounts: Record<string, number> = {};
    let missN = 0;
    for (const s of list) {
      if (s.direction === 'left' || s.direction === 'right') {
        missCounts[s.direction] = (missCounts[s.direction] ?? 0) + 1;
        missN++;
      }
    }
    let missSide: 'left' | 'right' | null = null;
    let missShare = 0;
    if (missN > 0) {
      const [side, count] = Object.entries(missCounts).sort((a, b) => b[1] - a[1])[0];
      missShare = count / missN;
      if (missN >= MIN_DECISION_SHOTS && missShare >= DOMINANT_SHARE) missSide = side as 'left' | 'right';
    }
    out.push({
      club,
      n: list.length,
      playedYds: played,
      expectedYds: expected,
      deltaYds: played != null && expected != null ? Math.round(played - expected) : null,
      missSide,
      missShare,
    });
  }
  return out.sort((a, b) => b.n - a.n);
}

/**
 * One honest line per club, addressed to the CADDIE about its own calling — never to the player
 * about their swing. "You have been under-clubbing him" is a note the caddie can act on; "he comes
 * up short" reads as blame for a shot he struck perfectly well.
 */
export function describeAdviceOutcome(o: AdviceOutcome): string | null {
  if (o.n < MIN_DECISION_SHOTS) return null;
  const parts: string[] = [];
  if (o.deltaYds != null && Math.abs(o.deltaYds) >= MEANINGFUL_DELTA_YDS) {
    parts.push(o.deltaYds < 0
      ? `plays ${Math.abs(o.deltaYds)}y SHORTER than the bag says — you have been under-clubbing him with it`
      : `plays ${o.deltaYds}y LONGER than the bag says — you have been over-clubbing him with it`);
  }
  if (o.missSide) parts.push(`clean strikes still finish ${o.missSide} — aim accordingly`);
  if (!parts.length) return null;
  return `${o.club}: ${parts.join('; ')} (${o.n} clean shots on your call)`;
}

/** The block handed to the brain. Silent when nothing is established — never filler. */
export function describeAdviceCalibration(outcomes: AdviceOutcome[], max = 6): string[] {
  return outcomes.map(describeAdviceOutcome).filter((l): l is string => !!l).slice(0, max);
}
