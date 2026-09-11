/**
 * THE OVERRIDE LOOP — what happens when the player does not take your club.
 *
 * 2026-09-11 (Tim). "We have to fix where it's conversational. It says okay, we're on the driver,
 * and you nominate something else, and it goes into… I don't kind of have the context loop. The
 * caddie's job is to agree, but point out — okay, but we're gonna have to really swing smooth and do
 * this. And you say okay, we'll go for the hero shot, and that's part of the data of when that
 * worked and when it didn't, when the user overrode."
 *
 * ─── WHAT WAS ACTUALLY MISSING ─────────────────────────────────────────────────────────────────
 *
 * Two halves, and both were absent for different reasons.
 *
 * THE LIVE HALF. The brain is never told what it last recommended. `pendingKevinRec` is written by
 * recommend_club, read by shotClubResolver at log time, and sent to the caddie NEVER — not by any
 * payload, not in the CNS block. So the caddie genuinely does not know it called driver ten seconds
 * ago. When the player says "I'll take the 3 wood", there is no contradiction for it to notice,
 * nothing to agree WITH, and no adjustment to name. It answers as if the question arrived cold.
 * That is not a model failing to be conversational; it is a model that was not told.
 *
 * THE LEARNED HALF. services/adviceOutcome — the caddie's self-calibration — requires, by rule 2,
 * that "the player took that club". That rule is CORRECT and stays exactly as it is: a shot hit with
 * a club the caddie did not call says nothing about whether the caddie's call was right. But its
 * consequence was that every override was dropped on the floor. The single most interesting thing a
 * golfer does — back their own judgement against the caddie's — was the one thing the app refused to
 * learn from.
 *
 * So this file is adviceOutcome's complement, deliberately SEPARATE from it. Override evidence must
 * never enter the club calibration, or the caddie starts grading itself on shots it never called.
 *
 * ─── THE RULE THAT MAKES THIS HONEST ───────────────────────────────────────────────────────────
 *
 * The caddie AGREES. Once. It names one adjustment and then it is the player's shot. A caddie who
 * re-argues a club he has already lost is not a caddie, and a player who gets a lecture every time
 * he backs himself stops telling the app what he is doing at all — which costs us the data too.
 *
 * And an override is judged the way smart bogey golf judges everything: DID IT COST A STROKE. Not
 * "was it closer", not "did the caddie turn out to be right". A shot that finds water is a failed
 * decision whoever chose it; a shot that is struck fat is an execution miss and is NOT counted, the
 * same discipline adviceOutcome applies to its own side. [[smartplay-core-ethos]]
 *
 * PURE. No stores, no hooks, no React, no network — the caller injects the bag and the normalizer,
 * exactly like adviceOutcome and playProfile, so this is testable and works with no signal.
 */

/** How this player covers an in-between yardage (playerProfileStore.distanceControl). */
export type DistanceControl = 'full_swings' | 'some_partials' | 'dial_down';

/**
 * The one thing that has to be true for the player's club to come off. Never more than one —
 * a caddie who lists three caveats has not agreed, he has argued in a friendly voice.
 */
export type OverrideDemand =
  | 'swing_smooth'
  | 'take_the_middle'
  | 'commit'
  | 'carry_the_trouble'
  | 'none';

export interface OverrideRead {
  advisedClub: string;
  chosenClub: string;
  /** Chosen club's carry minus the advised club's. Positive = more club. Null when a bag number is missing. */
  deltaYards: number | null;
  /** More club than called, less club, or the same number by a different route. */
  lean: 'more' | 'less' | 'sideways';
  /** What is left to the target after the chosen club, when the player cannot reach it. */
  leavesYards: number | null;
  demand: OverrideDemand;
  /** One sentence the caddie works in WHILE agreeing. Never a second one. */
  adjustment: string;
}

export interface OverrideReadInput {
  /** The club the caddie recommended (pendingKevinRec.club). */
  advisedClub: string | null | undefined;
  /** The club the player has declared instead. */
  chosenClub: string | null | undefined;
  /** Carry yards by club, already normalized by the caller (services/shotStrategy.bagDistances). */
  bag?: Record<string, number> | null;
  /** Collapses club vocabularies to one key — services/clubNormalize.normalizeClub. */
  normalize: (raw: string | null | undefined) => string | null;
  /** The working number for this shot. */
  yardsToTarget?: number | null;
  /** How this player covers an in-between yardage. Changes which adjustment is even AVAILABLE. */
  distanceControl?: DistanceControl | null;
  /** Yards from the pin to the back edge, when green geometry is known. */
  roomBehindYards?: number | null;
  /** Carry needed to clear trouble short of the target, when there is any. */
  carryNeededYards?: number | null;
}

/** A club taken instead of the one called, within this margin, is the same decision by another name. */
const SAME_NUMBER_MARGIN = 5;

function bagYards(bag: Record<string, number> | null | undefined, club: string | null): number | null {
  if (!bag || !club) return null;
  const v = bag[club];
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * The live half: the player has picked a different club. Returns null when there is nothing to
 * agree with — no advice outstanding, no club named, or the same club under another name.
 *
 * It deliberately does NOT decide whether the player is right. It states the size of the change and
 * the one condition attached to it, which is what a caddie says while handing the club over.
 */
export function readOverride(input: OverrideReadInput): OverrideRead | null {
  const advised = input.normalize(input.advisedClub ?? null);
  const chosen = input.normalize(input.chosenClub ?? null);
  if (!advised || !chosen) return null;
  if (advised === chosen) return null;

  const advisedYds = bagYards(input.bag, advised);
  const chosenYds = bagYards(input.bag, chosen);
  const deltaYards = advisedYds != null && chosenYds != null ? Math.round(chosenYds - advisedYds) : null;

  const lean: OverrideRead['lean'] =
    deltaYards == null || Math.abs(deltaYards) <= SAME_NUMBER_MARGIN
      ? 'sideways'
      : deltaYards > 0 ? 'more' : 'less';

  const target = typeof input.yardsToTarget === 'number' && input.yardsToTarget > 0 ? input.yardsToTarget : null;
  /**
   * "The 3 wood leaves you this." Only when they genuinely cannot reach — a club that covers the
   * number leaves nothing, and inventing a layup distance for a shot at the green would be the
   * fabricated data point this app refuses to show. [[illustration-data-points]]
   */
  const leavesYards =
    target != null && chosenYds != null && chosenYds < target ? Math.round(target - chosenYds) : null;

  const dc: DistanceControl = input.distanceControl ?? 'some_partials';
  const over = target != null && chosenYds != null ? Math.round(chosenYds - target) : null;
  const room = typeof input.roomBehindYards === 'number' && input.roomBehindYards > 0 ? input.roomBehindYards : null;
  const carryNeeded =
    typeof input.carryNeededYards === 'number' && input.carryNeededYards > 0 ? input.carryNeededYards : null;

  let demand: OverrideDemand = 'none';
  let adjustment = '';

  if (lean === 'more') {
    const long = `${Math.abs(deltaYards as number)} more club`;
    /**
     * THIS is the "plays like for ME" half of the override, and it is the whole differentiator.
     *
     * "Swing smooth" is advice you can only follow if you HAVE a smooth three-quarter swing. Tim:
     * "all I do right now is full swing and not good with dialing down yardages, so I play according
     * to my yardages and feel." Telling a full-swing player to take something off is telling them to
     * do the one thing they have said they cannot do — and they will either fail at it or ignore it.
     * For that player the honest adjustment is not about the swing at all: it is about where they
     * aim, because the ball IS going the full number.
     */
    if (dc === 'full_swings') {
      demand = 'take_the_middle';
      adjustment = room != null && over != null && over > room
        ? `That is ${long} and you swing it full — so play it to the front half; there is only ${Math.round(room)} yards past the pin.`
        : `That is ${long} and you swing it full — so aim at the middle and take the long side out of play, do not try to hold the number.`;
    } else if (room != null && over != null && over > room) {
      demand = 'take_the_middle';
      adjustment = `That is ${long}, and there is only ${Math.round(room)} yards behind the pin — smooth it and favour the front half.`;
    } else {
      demand = 'swing_smooth';
      adjustment = `That is ${long} — it only works smooth. Take something off it rather than making a full swing at it.`;
    }
  } else if (lean === 'less') {
    const short = `${Math.abs(deltaYards as number)} less club`;
    if (carryNeeded != null && chosenYds != null && chosenYds < carryNeeded) {
      demand = 'carry_the_trouble';
      adjustment = `That is ${short} and it needs ${Math.round(carryNeeded)} to carry the trouble — that club has to be flushed to get there.`;
    } else {
      demand = 'commit';
      adjustment = leavesYards != null
        ? `That is ${short} — it leaves you about ${leavesYards} in, so commit to it and take the number you are left with.`
        : `That is ${short} — there is no margin short, so make a committed swing at it rather than an easy one.`;
    }
  } else {
    demand = 'none';
    adjustment = deltaYards == null
      ? `Same shot, their club — go with it.`
      : `Same number by a different route — go with the one they are comfortable over.`;
  }

  return { advisedClub: advised, chosenClub: chosen, deltaYards, lean, leavesYards, demand, adjustment };
}

/* ────────────────────────────────────────────────────────────────────────────────────────────── */

export type OverrideShot = {
  club?: string | null;
  kevin_rec_club?: string | null;
  kevin_adhered?: boolean | null;
  feel?: 'flush' | 'solid' | 'fat' | 'thin' | 'heel' | 'toe' | 'pure' | 'topped' | null;
  outcome?: string | null;
  penalty_strokes?: number | null;
};

export interface OverrideSwap {
  from: string;
  to: string;
  n: number;
  worked: number;
}

export interface OverrideRecord {
  /** Overrides whose outcome was readable at all. */
  n: number;
  /** Of those, how many cost no stroke. */
  worked: number;
  workedShare: number;
  /** Do they habitually reach for MORE club than called, or less? Null when it is not one-sided. */
  lean: 'more' | 'less' | null;
  /** The swap they make most often. Null until it has happened enough to be a habit. */
  topSwap: OverrideSwap | null;
}

/**
 * Four is the same floor adviceOutcome uses, for the same reason: three overrides is a run of
 * decisions, not a habit, and a confident sentence built on it would change how the caddie talks to
 * a player whose judgement we have not actually observed.
 */
const MIN_OVERRIDE_SHOTS = 4;
/** A specific club swap is only worth naming once it has clearly repeated. */
const MIN_SWAP_SHOTS = 3;
/** Below this the player is not leaning either way and saying so would be reading noise. */
const LEAN_SHARE = 0.65;

/** Contact good enough that the DECISION, not the strike, is what we are looking at. */
const CLEAN_CONTACT = new Set(['flush', 'solid', 'pure']);

/**
 * Did this override cost a stroke?
 *
 *   null  — we cannot tell, or it is not ours to judge. A fat 3-wood is an execution miss; counting
 *           it against the player's judgement would teach the caddie to punish independence, and is
 *           the exact mistake adviceOutcome's rule 3 exists to prevent.
 *   false — it found trouble. A penalty is a failed decision no matter who chose the club, and under
 *           smart bogey golf it is the only failure that really matters.
 *   true  — struck cleanly and stayed in play.
 */
export function overrideWorked(s: OverrideShot): boolean | null {
  const penalised =
    (typeof s.penalty_strokes === 'number' && s.penalty_strokes > 0) ||
    (s.outcome != null && s.outcome !== 'clean');
  if (penalised) return false;
  if (!s.feel || !CLEAN_CONTACT.has(s.feel)) return null;
  return true;
}

export function overrideRecord(
  shots: OverrideShot[] | null | undefined,
  normalize: (raw: string | null | undefined) => string | null,
  bag?: Record<string, number> | null,
): OverrideRecord {
  const empty: OverrideRecord = { n: 0, worked: 0, workedShare: 0, lean: null, topSwap: null };
  const swaps = new Map<string, OverrideSwap>();
  let n = 0;
  let worked = 0;
  let more = 0;
  let less = 0;

  for (const s of shots ?? []) {
    if (!s) continue;
    // The complement of adviceOutcome: the caddie called something and the player played another.
    if (s.kevin_adhered !== false) continue;
    const from = normalize(s.kevin_rec_club ?? null);
    const to = normalize(s.club ?? null);
    if (!from || !to || from === to) continue;

    const ok = overrideWorked(s);
    if (ok == null) continue;
    n++;
    if (ok) worked++;

    const fromY = bagYards(bag, from);
    const toY = bagYards(bag, to);
    if (fromY != null && toY != null) {
      const d = toY - fromY;
      if (d > SAME_NUMBER_MARGIN) more++;
      else if (d < -SAME_NUMBER_MARGIN) less++;
    }

    const key = `${from}>${to}`;
    const cur = swaps.get(key);
    if (cur) { cur.n++; if (ok) cur.worked++; }
    else swaps.set(key, { from, to, n: 1, worked: ok ? 1 : 0 });
  }

  if (n === 0) return empty;

  const directional = more + less;
  let lean: OverrideRecord['lean'] = null;
  if (directional >= MIN_OVERRIDE_SHOTS) {
    if (more / directional >= LEAN_SHARE) lean = 'more';
    else if (less / directional >= LEAN_SHARE) lean = 'less';
  }

  const best = [...swaps.values()].sort((a, b) => b.n - a.n)[0] ?? null;
  return {
    n,
    worked,
    workedShare: worked / n,
    lean,
    topSwap: best && best.n >= MIN_SWAP_SHOTS ? best : null,
  };
}

/**
 * One line for the caddie about the player's own judgement — and the tone is the entire point.
 *
 * A player who backs himself and is RIGHT should hear that the caddie noticed. A player who is
 * consistently wrong gets it as information, never as a scold, and never unprompted mid-swing. This
 * is addressed to the caddie, like the calibration line beside it, not read back verbatim.
 */
export function describeOverrideRecord(rec: OverrideRecord): string | null {
  if (rec.n < MIN_OVERRIDE_SHOTS) return null;
  const pct = Math.round(rec.workedShare * 100);
  const parts: string[] = [];
  if (pct >= 70) {
    parts.push(`when he overrides your club he stays out of trouble ${pct}% of the time — his own read is good, so agree quickly and stop selling`);
  } else if (pct <= 40) {
    parts.push(`when he overrides your club it costs him a stroke ${100 - pct}% of the time — still agree, but name the one thing the club demands`);
  } else {
    parts.push(`he overrides your club about as often as not and it goes either way`);
  }
  if (rec.lean === 'more') parts.push('he reaches for MORE club than you call');
  else if (rec.lean === 'less') parts.push('he takes LESS club than you call');
  if (rec.topSwap) {
    parts.push(`most often ${rec.topSwap.from} → ${rec.topSwap.to} (${rec.topSwap.worked}/${rec.topSwap.n} clean)`);
  }
  return `${parts.join('; ')} (${rec.n} overrides)`;
}
