/**
 * 2026-09-11 (Tim) — DOES THIS CLUB NEED WORK?
 *
 * "Each club, part of its characteristics is if you need to do work on that club. If it's a strong
 * club or something you're consistently making errors [with], you need to kinda specifically work
 * around your mindset and approach to that club."
 *
 * Two things the app already knew separately and never joined:
 *   - clubTendency says what a club DOES (draws, misses right).
 *   - the shot log says how WELL it does it (strike quality, penalties).
 * A shape is not a verdict. A 5-wood that draws every time is a good club; a 5-wood that is fat
 * half the time is a club to work on, and the player should approach the two completely
 * differently on the course. Until now the ladder row showed the shape and said nothing about
 * whether the club was earning its place.
 *
 * PURE / SYNC / OFFLINE-SAFE / never throws — no React, no stores, no network. The caller supplies
 * the shots and the optional confidence number, exactly like clubTendency. That keeps it unit
 * testable and usable at zero signal. [[caddie-brain-lens]]
 *
 * HONESTY BAR: below MIN_WORK_SHOTS a club is 'unproven' and gets no verdict at all. Telling a
 * player his 3-iron "needs work" off two swings is the fabricated-data failure
 * [[illustration-data-points]], and it is the one that would make him stop believing the rest.
 */
import type { ClubTendency, MissSide } from './clubTendency';

export type ClubWorkStatus = 'strong' | 'steady' | 'needs_work' | 'unproven';

/** One shot's worth of evidence about a club. Deliberately a subset of ShotResult. */
export interface WorkShot {
  club: string | null;
  feel: 'flush' | 'solid' | 'fat' | 'thin' | 'heel' | 'toe' | 'pure' | 'topped' | null;
  outcome?: string;
  penalty_strokes?: number;
}

export interface ClubWork {
  club: string;
  status: ClubWorkStatus;
  /** Shots counted for this club. */
  n: number;
  /** Shots with a graded contact feel — the denominator for `strikeRate`. */
  strikeN: number;
  /** 0..1 share of graded contacts that were clean (flush/pure/solid), or null with no graded feel. */
  strikeRate: number | null;
  /** 0..1 share of shots that cost a stroke (penalty or a non-clean outcome). */
  penaltyRate: number;
  /** Received confidence passed in (relationshipStore's rated-swing clean rate), or null. */
  confidence: number | null;
  /** The dominant miss, when the tendency read one. Drives the mindset line. */
  miss: MissSide | null;
  /** One line for a club row — what this club is, in plain words. Never null. */
  line: string;
  /** What to actually practise, or null when nothing needs practising. */
  practice: string | null;
  /** How to think about it mid-round. Null for a club that needs no special handling. */
  mindset: string | null;
}

/**
 * Evidence bars. Six is a round's worth of swings with one club — enough that a bad day alone
 * cannot condemn a club, low enough that a genuinely broken club is named this week rather than
 * next month. Kept above clubTendency's MIN_SHAPE_SHOTS (4) on purpose: saying "you draw this"
 * is an observation, saying "this needs work" is a judgement and costs more to get wrong.
 */
export const MIN_WORK_SHOTS = 6;

/** Below this clean-contact share the club is not being struck well enough to trust. */
export const POOR_STRIKE = 0.45;
/** At or above this, the strike is genuinely good. */
export const GOOD_STRIKE = 0.7;
/** More than one shot in six costing a stroke is a club putting you in trouble, not a bad run. */
export const COSTLY_PENALTY_RATE = 0.17;

const CLEAN_FEEL = new Set(['flush', 'pure', 'solid']);
const MIS_FEEL = new Set(['fat', 'thin', 'topped', 'heel', 'toe']);

/** The fat/thin family, which is a strike fault, vs heel/toe, which is a centredness fault. */
const HEAVY_LIGHT = new Set(['fat', 'thin', 'topped']);

function pct(x: number): number { return Math.round(x * 100); }

export interface ClubWorkInput {
  /** Every shot you have logged anywhere, for every club. Filtered and grouped here. */
  shots: WorkShot[];
  /** Canonicalises a logged club name ('DR', 'driver', 'Driver') to one key. */
  normalize: (club: string | null | undefined) => string | null;
  /** Received confidence 0..1 per canonical club, or null where unmeasured. */
  confidenceFor?: (club: string) => number | null;
  /** Tendencies already derived by clubTendency, so the shape read has ONE owner. */
  tendencies?: ClubTendency[];
  /** Restrict the read to these canonical clubs (typically the bag). Empty/absent = every club seen. */
  clubs?: string[];
}

/**
 * Derive a work status per club. Returns one entry per club with at least one logged shot (or per
 * club in `clubs`, so a club you own but have never swung still gets an honest 'unproven' row).
 */
export function clubWorkStatuses(input: ClubWorkInput): ClubWork[] {
  const shots = Array.isArray(input.shots) ? input.shots : [];
  const normalize = typeof input.normalize === 'function' ? input.normalize : (c: string | null | undefined) => c ?? null;
  const only = input.clubs && input.clubs.length > 0 ? new Set(input.clubs) : null;

  const byClub = new Map<string, { n: number; strikeN: number; clean: number; heavy: number; offCentre: number; cost: number }>();
  const bump = (club: string) => {
    let cur = byClub.get(club);
    if (!cur) { cur = { n: 0, strikeN: 0, clean: 0, heavy: 0, offCentre: 0, cost: 0 }; byClub.set(club, cur); }
    return cur;
  };
  // Seed every requested club so an owned-but-unswung club reports 'unproven' rather than vanishing.
  if (only) for (const c of only) bump(c);

  for (const s of shots) {
    const club = normalize(s?.club ?? null);
    if (!club) continue;
    if (only && !only.has(club)) continue;
    const cur = bump(club);
    cur.n += 1;
    const feel = s?.feel ?? null;
    if (feel && (CLEAN_FEEL.has(feel) || MIS_FEEL.has(feel))) {
      cur.strikeN += 1;
      if (CLEAN_FEEL.has(feel)) cur.clean += 1;
      else if (HEAVY_LIGHT.has(feel)) cur.heavy += 1;
      else cur.offCentre += 1;
    }
    /**
     * A stroke actually lost. `outcome` is absent on pre-migration shots and those are treated as
     * clean by the store's own migration note, so absence must never read as a penalty — that
     * would make every long-time user's whole bag look broken on the day this shipped.
     */
    const penalty = typeof s?.penalty_strokes === 'number' && s.penalty_strokes > 0;
    const bad = typeof s?.outcome === 'string' && s.outcome !== '' && s.outcome !== 'clean';
    if (penalty || bad) cur.cost += 1;
  }

  const tendencyByClub = new Map<string, ClubTendency>();
  for (const t of input.tendencies ?? []) if (t && t.club) tendencyByClub.set(t.club, t);

  const out: ClubWork[] = [];
  for (const [club, v] of byClub.entries()) {
    const strikeRate = v.strikeN > 0 ? v.clean / v.strikeN : null;
    const penaltyRate = v.n > 0 ? v.cost / v.n : 0;
    const confidence = input.confidenceFor?.(club) ?? null;
    const tendency = tendencyByClub.get(club) ?? null;
    out.push(judge({
      club, n: v.n, strikeN: v.strikeN, strikeRate, penaltyRate, confidence,
      miss: tendency?.miss ?? null,
      heavyLead: v.heavy > v.offCentre,
      tendency,
    }));
  }
  return out.sort((a, b) => b.n - a.n);
}

interface JudgeInput {
  club: string;
  n: number;
  strikeN: number;
  strikeRate: number | null;
  penaltyRate: number;
  confidence: number | null;
  miss: MissSide | null;
  /** Whether the mis-hits lean fat/thin (a strike fault) rather than heel/toe (a centredness one). */
  heavyLead: boolean;
  tendency: ClubTendency | null;
}

function judge(a: JudgeInput): ClubWork {
  const base = {
    club: a.club, n: a.n, strikeN: a.strikeN, strikeRate: a.strikeRate,
    penaltyRate: a.penaltyRate, confidence: a.confidence, miss: a.miss,
  };

  if (a.n < MIN_WORK_SHOTS) {
    return {
      ...base,
      status: 'unproven',
      line: a.n === 0
        ? `${a.club} — no swings logged yet.`
        : `${a.club} — ${a.n} swing${a.n === 1 ? '' : 's'} logged, not enough to call it either way.`,
      practice: null,
      mindset: null,
    };
  }

  /**
   * The two ways a club earns 'needs_work', kept separate because they are different problems with
   * different answers. A club you STRIKE badly is a practice problem. A club that keeps costing you
   * strokes may be struck perfectly well and simply be the wrong club for where you are pulling it
   * — that is a course-management problem, and telling someone to go hit balls would be the wrong
   * advice. [[root-cause-only-no-bandaids]]
   */
  const poorStrike = a.strikeRate != null && a.strikeN >= MIN_WORK_SHOTS && a.strikeRate < POOR_STRIKE;
  const costly = a.penaltyRate >= COSTLY_PENALTY_RATE;
  const goodStrike = a.strikeRate != null && a.strikeN >= MIN_WORK_SHOTS && a.strikeRate >= GOOD_STRIKE;
  const confidentClub = a.confidence != null && a.confidence >= GOOD_STRIKE;

  const missPart = a.miss ? `, missing ${a.miss}` : '';
  const shapePart = a.tendency?.shape && a.tendency.shape !== 'straight' ? `${a.tendency.shape}s it` : null;
  const strikePart = a.strikeRate != null ? `${pct(a.strikeRate)}% clean contact` : `${a.n} swings`;

  if (poorStrike || costly) {
    const reasons: string[] = [];
    if (poorStrike) reasons.push(strikePart);
    if (costly) reasons.push(`${pct(a.penaltyRate)}% of swings cost a stroke`);
    const practice = poorStrike
      ? (a.heavyLead
          ? `Strike work: ${a.club} is coming up fat or thin. Half swings off a tight lie until the low point is in front of the ball.`
          : `Centre-of-face work: ${a.club} is finding heel and toe. Face spray or foot powder, ten balls, nothing but where it hit.`)
      : `Not a swing fault — ${a.club} keeps finding trouble. Practise the DECISION: where can this club actually go, and where is that on the course?`;
    const mindset = poorStrike
      ? (a.miss
          ? `Three-quarter swing and aim for the ${a.miss === 'left' ? 'right' : 'left'} half. Right now ${a.club} is not a club to be brave with.`
          : `Three-quarter swing, commit to the finish. ${a.club} is the club to play safe with today, not the one to save the hole with.`)
      : `Before you pull ${a.club}, say out loud where a bad one goes. If that answer is a penalty, take the next club down.`;
    return {
      ...base,
      status: 'needs_work',
      line: `${a.club} — needs work (${reasons.join(', ')})${missPart}.`,
      practice,
      mindset,
    };
  }

  if ((goodStrike || confidentClub) && !costly) {
    return {
      ...base,
      status: 'strong',
      line: `${a.club} — strong (${strikePart}${shapePart ? `, ${shapePart}` : ''}).`,
      practice: null,
      /**
       * A strong club still gets a mindset line, because the mistake with a good club is not
       * trusting it — laying up off a club you strike 80% of the time is how a strength goes unused.
       */
      mindset: `Trust it. When the plan is close, take the shot that leaves you ${a.club}.`,
    };
  }

  return {
    ...base,
    status: 'steady',
    line: `${a.club} — steady (${strikePart}${shapePart ? `, ${shapePart}` : ''})${missPart}.`,
    practice: null,
    mindset: a.miss ? `Aim to allow for the ${a.miss} miss and it is a club you can commit to.` : null,
  };
}

/** The clubs to actually put in front of the player: the ones that need work, worst first. */
export function clubsNeedingWork(all: ClubWork[]): ClubWork[] {
  return all
    .filter(w => w.status === 'needs_work')
    .sort((a, b) => (b.penaltyRate - a.penaltyRate) || ((a.strikeRate ?? 1) - (b.strikeRate ?? 1)));
}

/** The clubs to lean on. */
export function strongClubs(all: ClubWork[]): ClubWork[] {
  return all.filter(w => w.status === 'strong').sort((a, b) => (b.strikeRate ?? 0) - (a.strikeRate ?? 0));
}

/**
 * One answer-first summary for the brain and for a card header. Null when nothing is proven yet —
 * silence beats a sentence built out of nothing.
 */
export function describeClubWork(all: ClubWork[]): string | null {
  const weak = clubsNeedingWork(all);
  const strong = strongClubs(all);
  if (weak.length === 0 && strong.length === 0) return null;
  const parts: string[] = [];
  if (strong.length) parts.push(`Leaning on ${strong.slice(0, 3).map(w => w.club).join(', ')}`);
  if (weak.length) parts.push(`work to do with ${weak.slice(0, 3).map(w => w.club).join(', ')}`);
  return `${parts.join(' · ')}.`;
}
