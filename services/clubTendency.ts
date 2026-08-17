/**
 * 2026-08-17 (Tim — "wire in the club tendencies… this driving iron, I got it from the thrift shop,
 * and the thing gets two hundred and fifteen yards and a baby fade every single time. And I'd like
 * to see that before even looking — in the bag tendency or something, or the club properties").
 *
 * PER-CLUB tendency. The app knew shape and direction, and it knew distance, and it never joined
 * them to a club: services/patternDetection aggregates miss direction across the WHOLE BAG
 * (learnedMissDirection, patternDetection.ts:60), so a hooked driver and a pulled wedge pool into
 * one number and neither club has a character of its own. Distances are per-club in
 * clubStatsStore; shape simply was not. That is why nothing could ever say "the 3-iron fades".
 *
 * A club's tendency is one of the few things a golfer knows about their own bag before they know
 * their handicap, and it is the thing a real caddie learns first about a player's clubs. It is also
 * the honest kind of learning: it comes from shots already logged, needs no new capture, and says
 * nothing the shots don't support.
 *
 * PURE — takes shots and a carry lookup, imports no store, so it unit-tests and can be called from
 * a service, a screen, or the brain-context builder without booting anything.
 * [[illustration-data-points]] [[self-growing-agent-architecture]]
 */

export type ShotShape = 'draw' | 'straight' | 'fade';
export type MissSide = 'left' | 'right';

/** The shot fields this needs. Structural, so ShotResult satisfies it without an import. */
export interface TendencyShot {
  club?: string | null;
  shape?: ShotShape | null;
  direction?: string | null;
  distance_yards?: number | null;
  measuredCarry?: number | null;
}

export interface ClubTendency {
  club: string;
  /** Shots with a graded shape (the denominator for `shapeShare`). */
  shapeN: number;
  /** Dominant shape, or null when there isn't enough evidence or no shape leads clearly. */
  shape: ShotShape | null;
  /** 0..1 — how much of the graded sample that shape is. */
  shapeShare: number;
  /** Dominant miss side, or null. Independent of shape: a fade can still finish left. */
  miss: MissSide | null;
  missN: number;
  /** Carry the bag has learned for this club, passed in (this module owns no distance logic). */
  carryYds: number | null;
  /** Total shots seen for the club, graded or not. */
  n: number;
}

/**
 * Evidence bars. A tendency is a claim about a club's character, so it needs more than a couple of
 * shots — but a thrift-shop 3-iron that has been hit six times and faded five of them IS a fade,
 * and waiting for twenty would be pedantry about a thing the player already knows.
 */
export const MIN_SHAPE_SHOTS = 4;
export const DOMINANT_SHARE = 0.6;

function dominant<T extends string>(counts: Record<string, number>, total: number): { key: T | null; share: number } {
  let bestKey: string | null = null;
  let bestN = 0;
  for (const [k, v] of Object.entries(counts)) {
    if (v > bestN) { bestN = v; bestKey = k; }
  }
  if (bestKey == null || total <= 0) return { key: null, share: 0 };
  return { key: bestKey as T, share: bestN / total };
}

/**
 * Derive per-club tendencies from logged shots.
 *
 * @param shots      every shot available (current round + history); order irrelevant.
 * @param carryFor   the bag's learned carry for a club, or null. Injected to keep this pure.
 * @param normalize  club-name normalizer, injected for the same reason. Shots written in different
 *                   vocabularies MUST collapse to one key or a club's evidence splits across rows —
 *                   the exact defect services/clubNormalize exists to prevent.
 */
export function clubTendencies(
  shots: TendencyShot[] | null | undefined,
  carryFor: (club: string) => number | null,
  normalize: (raw: string | null | undefined) => string | null,
): ClubTendency[] {
  const byClub = new Map<string, TendencyShot[]>();
  for (const s of shots ?? []) {
    const club = normalize(s?.club ?? null);
    if (!club) continue; // an unresolvable club can't own a tendency
    const arr = byClub.get(club);
    if (arr) arr.push(s); else byClub.set(club, [s]);
  }

  const out: ClubTendency[] = [];
  for (const [club, list] of byClub) {
    const shapeCounts: Record<string, number> = {};
    let shapeN = 0;
    const missCounts: Record<string, number> = {};
    let missN = 0;
    for (const s of list) {
      if (s.shape === 'draw' || s.shape === 'straight' || s.shape === 'fade') {
        shapeCounts[s.shape] = (shapeCounts[s.shape] ?? 0) + 1;
        shapeN++;
      }
      // A miss side is only a miss when it went somewhere: 'straight' is not a side.
      if (s.direction === 'left' || s.direction === 'right') {
        missCounts[s.direction] = (missCounts[s.direction] ?? 0) + 1;
        missN++;
      }
    }
    const shapeDom = dominant<ShotShape>(shapeCounts, shapeN);
    const missDom = dominant<MissSide>(missCounts, missN);
    out.push({
      club,
      n: list.length,
      shapeN,
      shape: shapeN >= MIN_SHAPE_SHOTS && shapeDom.share >= DOMINANT_SHARE ? shapeDom.key : null,
      shapeShare: shapeDom.share,
      miss: missN >= MIN_SHAPE_SHOTS && missDom.share >= DOMINANT_SHARE ? missDom.key : null,
      missN,
      carryYds: carryFor(club),
    });
  }
  // Most-hit clubs first: the ones the player actually plays lead.
  return out.sort((a, b) => b.n - a.n);
}

/**
 * One honest line per club, for the brain and for a card. Says only what the sample supports, and
 * says nothing at all when there's no distance and no established shape — an empty line is better
 * than a confident sentence about three shots.
 */
export function describeClubTendency(t: ClubTendency): string | null {
  const bits: string[] = [];
  if (t.carryYds != null && t.carryYds > 0) bits.push(`${Math.round(t.carryYds)}y carry`);
  if (t.shape) {
    // "8 of 10" rather than a percentage: a golfer counts shots, not rates.
    const of = `${Math.round(t.shapeShare * t.shapeN)} of ${t.shapeN}`;
    bits.push(t.shape === 'straight' ? `dead straight (${of})` : `${t.shape} (${of})`);
  }
  if (t.miss && !t.shape) bits.push(`misses ${t.miss}`);
  if (bits.length === 0) return null;
  return `${t.club} — ${bits.join(', ')}`;
}

/** The compact block the caddie reads: established tendencies only, longest clubs' evidence first. */
export function describeBagTendencies(tendencies: ClubTendency[], max = 8): string[] {
  return tendencies
    .filter((t) => t.shape != null || t.miss != null)
    .slice(0, max)
    .map(describeClubTendency)
    .filter((s): s is string => s != null);
}
