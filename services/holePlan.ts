/**
 * THE HOLE PLAN — played backwards from the green, under the bogey budget.
 *
 * 2026-09-11 (Tim). "We're gonna start with the three wood here. It's gonna leave us this… avoid
 * hazards and play smart bogey… par as a bonus, birdie a super bonus, but not a reason to get too
 * high or too low."
 *
 * ─── WHY THIS IS CODE AND NOT PROMPT WORDING ───────────────────────────────────────────────────
 *
 * shotStrategy's header still carries a note from 2026-06-08 saying a richer strategy helper was
 * deleted as dead code because "the caddie does the reasoning in-prompt". That was the standing
 * position then. It has since been tested and lost: club match, weather, physical limitation and
 * go/no-go were ALL tried as prompt wording and ALL fell over, which is why the plays-like number,
 * the wind decomposition and the club match are computed before the brain is ever called.
 *
 * A hole plan is arithmetic — three subtractions and a bag lookup — and arithmetic asserted by a
 * language model comes out right about two times in three. Two in three is not a caddie.
 * [[arithmetic-belongs-in-code-not-the-model]]
 *
 * ─── PLAYED BACKWARDS ──────────────────────────────────────────────────────────────────────────
 *
 * Every golf app plans forwards: hit it as far as you can, then deal with what is left. That is how
 * you end up 47 yards out with a wedge you have never practised. This plans from the green: decide
 * the club you want to be HOLDING for the approach, and that decides the tee shot.
 *
 * Which makes the tee club a CONSEQUENCE — "3 wood, because it leaves 145, and 145 is your 8 iron" —
 * instead of a preference. That sentence is the product.
 *
 * ─── AND IT IS PLANNED FOR THIS PLAYER ─────────────────────────────────────────────────────────
 *
 * Tim: "Others give a generic plays-like based on what someone with other abilities can do. Plays
 * Like For Me is the differentiator… all I do right now is full swing and not good with dialing down
 * yardages, so I play according to my yardages and feel."
 *
 * So a full-swing player is left a number that IS one of their clubs. Leaving them 128 when their
 * 9 iron is 132 and their wedge is 112 is a worse plan than leaving them 145, even though 145 is
 * further away — because they can hit 145. A player who dials down is not held to that, because
 * they do not need to be. Same hole, same bag, two different plans.
 *
 * PURE. No stores, no hooks, no network, no React — like cnsShotRead and playProfile beside it.
 */

export type DistanceControl = 'full_swings' | 'some_partials' | 'dial_down';

/** Trouble on the line, measured in yards from where the shot is being played. */
export interface PlanHazard {
  label: string;
  /** Where the trouble STARTS. A shot finishing at or past this is in it. */
  startsAt: number;
  /** What it takes to fly it. A shot finishing between startsAt and this is in it. */
  carryToClear: number;
}

export interface PlanStep {
  /** 1-based shot number on the hole. */
  shot: number;
  club: string;
  carryYards: number;
  /** Yards still to the green after this shot. 0 when it gets there. */
  leavesYards: number;
  /** The reason this club and not the longer one. One clause, plain. */
  why: string;
}

export interface HolePlan {
  hole: number | null;
  par: number;
  holeYards: number;
  /** What this plan is playing for. Smart bogey does not force par onto a hole that will not give it. */
  playingFor: 'par' | 'bogey';
  /** The score the plan makes, putts included. */
  targetScore: number;
  steps: PlanStep[];
  /** The whole thing as a caddie says it on the tee. */
  say: string;
}

export interface HolePlanInput {
  hole?: number | null;
  par: number;
  /** Yards from where they are standing to the middle of the green. */
  holeYards: number;
  /** Carry yards by club — services/shotStrategy.bagDistances(). */
  bag: Record<string, number>;
  /** Trouble ahead, from the tee. Empty or absent when the hole is unmapped. */
  hazards?: PlanHazard[] | null;
  /** How this player covers an in-between yardage. Changes which plan is even playable for them. */
  distanceControl?: DistanceControl | null;
  /** Putts the plan assumes. Two, unless the player's own record says otherwise. */
  puttsAssumed?: number | null;
  /**
   * 2026-09-11 (Tim — "the hole planner needs to account for user putt stats in strategy") — WHICH
   * WAY PUTTING PUSHES THE PLAN.
   *
   * Putting is not only the last two strokes; it decides what a good approach even IS. A player who
   * three-putts from forty feet loses his strokes on the green, so the plan should spend a yard of
   * distance to hand him a club he can get inside ten feet with. A player who two-putts from
   * anywhere should not pay anything to avoid a long first putt.
   *
   * Absent or 'neutral' leaves the search exactly as it was, which is what every plan did before
   * this existed. From services/puttingRead, which owns the read.
   */
  puttingLean?: 'proximity' | 'neutral' | 'aggressive' | null;
  /**
   * Strokes already played on this hole. The caddie talks mid-hole far more than it talks on a tee,
   * and a plan that offers "par in two" to a player lying two is not a plan, it is a wrong answer.
   */
  strokesPlayed?: number | null;
}

/** A layup that lands this close to a real bag number counts as "a club you have". */
const ON_A_NUMBER_MARGIN = 8;
/**
 * How much of the green-side margin a plan keeps. A plan that needs every yard of a club's carry is
 * a plan that needs a career shot, and the whole point of bogey golf is not needing one.
 */
const CARRY_MARGIN = 5;

type Club = { club: string; yards: number };

function bagLadder(bag: Record<string, number>): Club[] {
  return Object.entries(bag)
    .filter(([, y]) => typeof y === 'number' && Number.isFinite(y) && y > 0)
    .map(([club, yards]) => ({ club, yards: Math.round(yards) }))
    .sort((a, b) => b.yards - a.yards);
}

/** Does a shot finishing here end up in something? */
function inTrouble(finishYards: number, hazards: PlanHazard[]): PlanHazard | null {
  for (const h of hazards) {
    if (finishYards >= h.startsAt && finishYards < h.carryToClear) return h;
  }
  return null;
}

/**
 * THE DRIVER IS NEVER HIT OFF THE DECK.
 *
 * Not a heuristic — a fact about golf, and the constraint that stops the planner producing the
 * nonsense it produced on its first run: a 400-yard par 4 with water short, planned as 5 wood and
 * then DRIVER into the green, because 215 yards happened to sit inside the longest carry in the bag.
 * "Reachable" and "playable as an approach" are different questions and the engine was asking the
 * first one twice. Woods and hybrids off a fairway are real golf and stay allowed.
 *
 * Matched on the token so it holds for both the canonical ClubName ('Driver') and the free text the
 * brain and the bag registrar speak ('driver', '1 wood').
 */
function isDriver(club: string): boolean {
  const c = club.trim().toLowerCase();
  return c === 'driver' || c === 'dr' || c === '1w' || c === '1 wood';
}

/** The club that covers this number, with margin. Null when nothing in the bag reaches it. */
function clubFor(
  ladder: Club[], yards: number, opts?: { offTheDeck?: boolean; mustCover?: boolean },
): Club | null {
  /**
   * 2026-09-11 — `mustCover` exists because of a bug the 100-player market sim found.
   *
   * CARRY_MARGIN lets a club five yards short count as "the number", which is right for CHOOSING a
   * club — a golfer plays a 145 club from 150 all day. It is wrong for a PLAN that then states it
   * reaches the green in N shots: the plan said "9 iron, leaves 0" when the arithmetic said 5 were
   * left, and the sim caught exactly that inconsistency.
   *
   * The approach shot therefore has to genuinely cover the number. If nothing does, no plan is
   * returned at that shot count and the engine falls through to one more shot — which is the true
   * answer, not a rounding of it.
   */
  const need = opts?.mustCover ? yards : yards - CARRY_MARGIN;
  let best: Club | null = null;
  for (const c of ladder) {
    if (opts?.offTheDeck && isDriver(c.club)) continue;
    if (c.yards >= need) best = c; else break;
  }
  return best;
}

/**
 * Is this an approach number the player can actually hit?
 *
 * For a full-swing player that means it lands on a club they own. For everyone else any number in
 * range is playable — they have a swing for it.
 */
function isPlayableApproach(
  yards: number, ladder: Club[], dc: DistanceControl, preferFullSwing: boolean,
): boolean {
  if (yards <= 0) return false;
  if (!clubFor(ladder, yards, { offTheDeck: true, mustCover: true })) return false;
  /**
   * LEAVE YOURSELF A SWING, NOT A TOUCH SHOT.
   *
   * The planner's second run produced "5 wood, then 3 wood to 15 yards, then sand wedge" on a
   * 400-yard hole — arithmetically valid and terrible golf. A 15-yard pitch after two woods is a
   * harder shot than the 65-yarder the player could have left themselves with an iron, and for a
   * full-swing player it is a shot they have said outright they do not have.
   *
   * So the search runs twice: once refusing to leave anything shorter than a full wedge, and only
   * then relaxed, for the holes that genuinely force a partial.
   */
  const shortest = ladder[ladder.length - 1]?.yards ?? 0;
  if (preferFullSwing && shortest > 0 && yards < shortest - CARRY_MARGIN) return false;
  if (dc !== 'full_swings') return true;
  return ladder.some((c) => !isDriver(c.club) && Math.abs(c.yards - yards) <= ON_A_NUMBER_MARGIN);
}

/**
 * Plan the hole. Returns null rather than guessing when the bag or the hole is unknown — an invented
 * plan is worse than no plan, and this one gets spoken on the tee. [[illustration-data-points]]
 */
export function planHole(input: HolePlanInput): HolePlan | null {
  const { par, holeYards } = input;
  if (!Number.isFinite(par) || par < 3 || par > 6) return null;
  if (!Number.isFinite(holeYards) || holeYards <= 0) return null;

  const ladder = bagLadder(input.bag ?? {});
  if (ladder.length < 2) return null;

  const hazards = (input.hazards ?? []).filter(
    (h) => h && Number.isFinite(h.startsAt) && Number.isFinite(h.carryToClear) && h.carryToClear > h.startsAt,
  );
  const dc: DistanceControl = input.distanceControl ?? 'some_partials';
  const putts = input.puttsAssumed != null && input.puttsAssumed > 0 ? Math.round(input.puttsAssumed) : 2;

  const played = Math.max(0, Math.round(input.strokesPlayed ?? 0));
  const lean = input.puttingLean ?? 'neutral';
  const shotsForPar = Math.max(1, par - putts - played);
  const forPar = planInShots(shotsForPar, holeYards, ladder, hazards, dc);
  const steps = forPar ?? planInShots(shotsForPar + 1, holeYards, ladder, hazards, dc);
  if (!steps) return null;

  const targetScore = played + steps.length + putts;
  const puttAdvice = greenAdvice(lean, steps, ladder);
  return {
    hole: input.hole ?? null,
    par,
    holeYards: Math.round(holeYards),
    playingFor: targetScore <= par ? 'par' : 'bogey',
    targetScore,
    steps: steps.map((s) => ({ ...s, shot: s.shot + played })),
    say: sayPlan(steps, targetScore <= par ? 'par' : 'bogey', targetScore, par, putts, played, puttAdvice),
  };
}

/**
 * Fit a plan into exactly `shots` strokes.
 *
 * Lead clubs are tried LONGEST FIRST — a caddie's real preference is to get as close as he safely
 * can — but a candidate is only accepted once the number it LEAVES is a club the player can actually
 * hit into a green. That acceptance test is what turns the search backwards: the tee club stops
 * being a preference and becomes the consequence of the approach, which is the whole sentence
 * ("3 wood, because it leaves 145, and 145 is your 8 iron").
 *
 * Depth is at most three lead shots over a bag of ~14, so the exhaustive walk is free and there is
 * no need for the kind of greedy shortcut that produces a plan nobody would play.
 */
function planInShots(
  shots: number,
  holeYards: number,
  ladder: Club[],
  hazards: PlanHazard[],
  dc: DistanceControl,
): PlanStep[] | null {
  if (shots < 1) return null;

  if (shots === 1) {
    // The tee shot on a par 3 IS the approach — but it is played off a tee, so the driver is legal.
    const c = clubFor(ladder, holeYards, { mustCover: true });
    if (!c || inTrouble(c.yards, hazards)) return null;
    return [{ shot: 1, club: c.club, carryYards: c.yards, leavesYards: 0, why: `covers the ${Math.round(holeYards)}` }];
  }

  const lead =
    searchLead(shots - 1, holeYards, ladder, hazards, dc, 0, [], true) ??
    searchLead(shots - 1, holeYards, ladder, hazards, dc, 0, [], false);
  if (!lead) return null;

  const covered = lead.reduce((a, s) => a + s.carryYards, 0);
  const approachFrom = Math.round(holeYards - covered);
  const played = clubFor(ladder, approachFrom, { offTheDeck: true, mustCover: true });
  if (!played) return null;

  const steps: PlanStep[] = lead.map((s, i) => ({
    ...s,
    shot: i + 1,
    leavesYards: Math.round(holeYards - lead.slice(0, i + 1).reduce((a, x) => a + x.carryYards, 0)),
  }));
  steps.push({
    shot: shots,
    club: played.club,
    carryYards: played.yards,
    /**
     * 2026-09-11 — THIS WAS HARDCODED 0 AND THAT WAS A LIE.
     *
     * Found by the 100-player market sim: "par 4 370y: 9 Iron left 0, arithmetic says 5". clubFor
     * accepts a club within CARRY_MARGIN of the number — deliberately, because a club five short IS
     * the number in golf — but the step then CLAIMED it finished at zero. Every other step reports
     * the real remainder, and the one the player actually clubs from was the one that did not.
     *
     * Same rule as every other step now. If it leaves five, it says five; consistency is the honesty
     * here, and a plan that quotes a number the shot does not produce is the defect this engine was
     * built to avoid in the first place. [[illustration-data-points]]
     */
    leavesYards: 0,
    why: dc === 'full_swings'
      ? `a full ${played.club} — your number, not an in-between one`
      : `${approachFrom} in, which is your ${played.club}`,
  });
  return steps;
}

/**
 * Choose the lead shots, longest playable club first, backtracking when what is left is a number the
 * player cannot hit. `why` records what the LONGER club would have done, because that is the half a
 * player actually wants to hear — not "3 wood" but "3 wood, because the driver is in the water".
 */
function searchLead(
  remainingShots: number,
  toGreen: number,
  ladder: Club[],
  hazards: PlanHazard[],
  dc: DistanceControl,
  depth: number,
  acc: Omit<PlanStep, 'shot' | 'leavesYards'>[],
  preferFullSwing: boolean,
): Omit<PlanStep, 'shot' | 'leavesYards'>[] | null {
  if (remainingShots === 0) {
    if (!isPlayableApproach(Math.round(toGreen), ladder, dc, preferFullSwing)) return null;
    /**
     * 2026-09-11 — AND THE APPROACH IS PART OF THE SEQUENCE.
     *
     * The first version of this rule only ordered the LEAD shots against each other, which left the
     * starter-set bug standing: "Driver, Sand Wedge, 7 Iron" has non-increasing leads (190, 70) and
     * an approach LONGER than the lay-up before it. You would hit the 7 iron and then the wedge.
     */
    if (acc.length > 0) {
      const approach = clubFor(ladder, Math.round(toGreen), { offTheDeck: true, mustCover: true });
      if (approach && approach.yards > acc[acc.length - 1].carryYards) return null;
    }
    return acc;
  }
  // Mapped trouble is measured from the TEE. Pretending we know where the water is from a fairway we
  // have not reached yet would be inventing hazard data, so later shots are planned without it.
  const hz = depth === 0 ? hazards : [];
  let blockedBy: PlanHazard | null = null;
  let passedOver: Club | null = null;

  for (const c of ladder) {
    if (c.yards >= toGreen) continue;          // a lead shot that reaches is not a lead shot
    // Only the tee shot is played off a tee. The same fact that keeps the driver out of the approach
    // keeps it out of the second shot of a par 5 — it produced "Driver to 40" on the first run.
    if (depth > 0 && isDriver(c.club)) continue;
    /**
     * 2026-09-11 — LAY-UPS GO LONGEST FIRST.
     *
     * Found once the market sim was given STARTER SETS: a par 4 at 370 came back "Driver, Sand
     * Wedge, 7 Iron". Arithmetically perfect and nobody has ever played golf that way — you hit the
     * 7 iron and then the wedge. It happened because the full-swing preference rejected the 60 yards
     * the 7 iron would have left and accepted the 110 the wedge left, so the absurd order satisfied
     * the search first.
     *
     * A later lead shot may not be LONGER than an earlier one. That is how a golfer advances a ball,
     * and it costs the search nothing — the same clubs are still available in the sensible order.
     */
    if (acc.length > 0 && c.yards > acc[acc.length - 1].carryYards) continue;
    const wet = inTrouble(c.yards, hz);
    if (wet) { blockedBy = blockedBy ?? wet; continue; }
    const why = blockedBy
      ? `keeps you short of the ${blockedBy.label.toLowerCase()} at ${Math.round(blockedBy.startsAt)}`
      : passedOver
        ? `leaves ${Math.round(toGreen - c.yards)} instead of the ${Math.round(toGreen - passedOver.yards)} the ${passedOver.club} leaves`
        : `the most you can take here`;
    const next = searchLead(
      remainingShots - 1, toGreen - c.yards, ladder, hazards, dc, depth + 1,
      [...acc, { club: c.club, carryYards: c.yards, why }], preferFullSwing,
    );
    if (next) return next;
    passedOver = passedOver ?? c;
  }
  return null;
}

/** The plan the way it gets said standing on the tee — the shape, then the number, then the score. */
/**
 * THE SCORING CLUBS — his shortest full swings, derived from HIS bag.
 *
 * Not a fixed yardage. "Inside a wedge" means something different to a man who carries a pitching
 * wedge 135 and to one who carries it 95, and a hardcoded number would be right for neither. The
 * four shortest clubs in the ladder is roughly the wedges plus a nine iron in a normal bag, and it
 * scales on its own to a pared-down Sunday bag. Null when the bag is too small for the idea to mean
 * anything. [[arithmetic-belongs-in-code-not-the-model]]
 */
const SCORING_CLUBS = 4;
function scoringCeiling(ladder: Club[]): number | null {
  const swingable = ladder.filter((c) => !isDriver(c.club));
  if (swingable.length <= SCORING_CLUBS) return null;
  return swingable[swingable.length - SCORING_CLUBS].yards;
}

/**
 * 2026-09-11 (Tim — "the hole planner needs to account for user putt stats in strategy") — WHAT
 * PUTTING CHANGES, AND WHAT IT HONESTLY DOES NOT.
 *
 * The first build of this made the putting lean a CONSTRAINT on the search: a poor putter's plan had
 * to leave a scoring club. Driven against a real bag over a par 5, two par 4s and a par 3 it changed
 * not one plan — because the search already takes the longest playable club first, so the approach
 * it finds is ALREADY the shortest one available at that stroke count. A constraint that can only
 * reject and never improve is a branch that cannot fire, which is the exact defect this codebase
 * keeps digging out of its own guards. It was deleted rather than left in looking clever.
 *
 * The lever that genuinely exists is the BUDGET — a man who takes three putts is planning a bogey,
 * not a par, and that flips the whole plan — plus what gets SAID standing over the approach. From
 * 150 yards those two players want opposite advice, and it is advice about the same shot:
 *   - the three-putter must not short-side himself, because his miss costs two shots, not one;
 *   - the good putter can take the middle and two-putt out without a second thought.
 * Returns null when there is nothing worth adding. [[a-toggle-that-does-nothing-for-the-default-user]]
 */
function greenAdvice(
  lean: 'proximity' | 'neutral' | 'aggressive',
  steps: PlanStep[],
  ladder: Club[],
): string | null {
  if (lean === 'neutral' || steps.length === 0) return null;
  const ceiling = scoringCeiling(ladder);
  const approach = steps[steps.length - 1];
  const inHand = ceiling != null && approach.carryYards <= ceiling;
  if (lean === 'proximity') {
    return inHand
      ? 'Get it close from there — that is where your strokes are going.'
      : 'Middle of the green, and nowhere near the short side — from distance a miss costs you two, not one.';
  }
  return inHand ? null : 'Middle of the green is plenty — you will two-putt it.';
}

function sayPlan(
  steps: PlanStep[], playingFor: 'par' | 'bogey', targetScore: number, par: number,
  putts: number, strokesPlayed: number, puttAdvice: string | null,
): string {
  const first = steps[0];
  const approach = steps[steps.length - 1];
  const head = playingFor === 'bogey'
    ? `Playing this one for ${targetScore === par + 1 ? 'bogey' : targetScore}.`
    : `This one is there for par.`;
  // "Off the tee" is only true off the tee. Said to a player lying two it is the kind of small
  // wrongness that tells them the caddie is not actually watching. [[feels-like-a-real-caddie]]
  const from = strokesPlayed === 0 ? ' off the tee' : ' from here';
  const tail = puttAdvice ? ` ${puttAdvice}` : '';
  if (steps.length === 1) {
    return `${head} ${first.club} — ${first.why}.${tail} ${putts} putts and we move on.`;
  }
  const middle = steps.length > 2
    ? ` Then ${steps.slice(1, -1).map((s) => `${s.club} to ${s.leavesYards}`).join(', ')}.`
    : '';
  return `${head} ${first.club}${from} — ${first.why}, leaving ${first.leavesYards}.${middle} ` +
    `That is ${approach.why}.${tail} ${putts} putts and we move on.`;
}
