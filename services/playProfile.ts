/**
 * PLAY PROFILE — one composed answer to "who is this golfer, and how should we play this round?"
 *
 * 2026-09-11 (Tim). "We need to make sure we have an engine for the strengths and weaknesses, a play
 * profile… and all of this is embedded, all the data through the app goes back and forth through
 * this and back and forth."
 *
 * WHY THIS EXISTS. Every signal below was already being measured — bag gaps, dominant miss, penalty
 * pattern, putting, adherence, distance control, experience level. They sat in six different stores,
 * and the brain was handed a handful of raw fields (handicap, dominantMiss, persistentPatterns) and
 * left to infer the player fresh on every single turn. Nothing in the app ever said, in one place,
 * "here is what this golfer does well and badly." So nothing could reason from it.
 *
 * SMART BOGEY GOLF IS THE LENS. Tim: "we're playing smart bogey golf, not doing what a pro does…
 * seventeen bogeys and one par and you break ninety… par is a bonus, birdie a super bonus, but not a
 * reason to get too high or too low."
 *
 * That reframing is the product. A double is not a failure when the target is 90 — it is one of the
 * few you had in hand. The profile carries the target and the arithmetic so every surface can say so.
 *
 * SEEDED BY LEVEL, SHARPENED BY DATA — and it says which.
 *
 * Tim: "that's good for beginners by level. We don't need three rounds to kinda prove this point."
 * He is right, and it is the fix for the cold-start problem that makes most "learning" apps useless
 * exactly when a new player needs them most. A player who has logged nothing still gets real
 * guidance, because their stated level is real information.
 *
 * But a seeded claim is NOT a measured one, and this file never lets the two blur: every finding
 * carries its `source`, and `confidence` reports the weakest link. A surface can then say "most
 * players starting out lose shots here" rather than "you lose shots here" — which is the difference
 * between honest and made up. [[illustration-data-points]]
 *
 * PURE. No stores, no hooks, no network, no React. The caller passes everything in, exactly like
 * services/cnsShotRead — so it is unit-testable, harness-safe, and usable with no signal.
 */
import type { CoachingComplexity } from './coachingAdaptation';

export type RoundGoal = 'break_100' | 'break_90' | 'break_80' | 'free_play';
export type FindingSource = 'seeded' | 'measured';

export interface PlayFinding {
  /** Short, player-facing. "You lose shots off the tee" / "Your wedges are reliable". */
  text: string;
  /** Where the claim came from. A seeded finding is a prior from their level, not an observation. */
  source: FindingSource;
}

export interface PlayProfile {
  level: CoachingComplexity;
  goal: RoundGoal;
  /** The score that goal implies, or null for free play. */
  targetScore: number | null;
  /** Strokes over par the target allows across 18 — the bogey budget. */
  strokeBudget: number | null;
  /** Holes this round is over — 18 unless the round says otherwise. Owns the "holes left" maths. */
  holeCount: number;
  strengths: PlayFinding[];
  weaknesses: PlayFinding[];
  /**
   * Short in-play reminders, already filtered to this player's level. "Chip: don't decelerate."
   * Deliberately NOT one per shot — see cuesFor.
   */
  cues: PlayFinding[];
  /** 'seeded' when nothing has been measured yet; 'measured' once real signals carry it. */
  confidence: 'seeded' | 'mixed' | 'measured';
}

export interface PlayProfileInput {
  level: CoachingComplexity;
  goal?: RoundGoal | null;
  /** Par for the course, for the stroke budget. Defaults to 72. */
  coursePar?: number | null;
  /**
   * How many holes this round is. Nine for a nine-hole round, and it is not a cosmetic detail — it
   * decides both the target and how many holes are left to spend the budget on.
   */
  courseHoles?: number | null;
  /** How the player covers an in-between yardage. */
  distanceControl?: 'full_swings' | 'some_partials' | 'dial_down' | null;
  /** CNS-learned miss side, when there is one. */
  dominantMiss?: 'left' | 'right' | 'straight' | null;
  /** Real holes in the bag, from services/practice/fitProfile. */
  bagGapCount?: number | null;
  /** Penalties per 18 the player actually takes. */
  penaltiesPerRound?: number | null;
  /** Putts per 18 the player actually takes. */
  puttsPerRound?: number | null;
  /** Fraction of caddie club calls the player takes (0-1), from adviceOutcome. */
  adherenceRate?: number | null;
  /** Rounds logged together — how much the measured half is worth. */
  roundsPlayed?: number | null;
}

/**
 * 2026-09-11 (Tim — "you're gonna have a three-club bag on a par-three nine-hole course, so that
 * should in and of itself have its own kind of logic") — THE GOAL IS A STANDARD, NOT A NUMBER.
 *
 * This table used to hold 99 / 89 / 79 and the budget was `target - coursePar`. On a nine-hole
 * par-27 course that made the budget 89 − 27 = 62 strokes in hand, and the caddie said so:
 * "58 shots in hand for 15 holes", on a nine-hole round, fifteen holes that do not exist.
 *
 * "Break 90" is not the number 89. It is a SCORING STANDARD — seventeen over par, which is bogey on
 * every hole bar one, which is the whole bogey-golf lens this file exists to state. Held as strokes
 * over par and scaled to the holes actually being played, it means the same thing on a par-3 nine as
 * it does at Torrey Pines, and the number it prints is a number for THIS round.
 *
 * Scaled by HOLES rather than by par on purpose: the standard is about how many holes you can drop a
 * shot on. Scaling by par would tighten a par-3 course to +6 — a standard no one playing a par-3
 * nine is trying to meet — while nine holes of bogey golf is exactly half of eighteen.
 */
const TARGET: Record<RoundGoal, number | null> = {
  break_100: 99, break_90: 89, break_80: 79, free_play: null,
};

/**
 * The same standards as strokes over par, used ONLY when the round is not a full eighteen.
 *
 * Over eighteen holes the goal keeps its literal meaning — a man who shoots 89 on a par 70 has
 * broken ninety, and telling him he needed 87 would be the app moving his goalposts. It is the
 * shorter round that has no literal reading at all: "break 90" over nine holes is a standard or it
 * is nothing.
 */
const OVER_PAR: Record<RoundGoal, number | null> = {
  break_100: 27, break_90: 17, break_80: 7, free_play: null,
};

/** The card these standards are stated against. */
const STANDARD_HOLES = 18;

/**
 * Level-seeded priors. These are the things that are true of most players AT THAT LEVEL, stated as
 * such, so a player with no history still gets something real on their first hole.
 */
const SEEDED_WEAKNESS: Record<CoachingComplexity, string[]> = {
  simple: ['Penalty strokes are where the round goes — one bad swing costs two', 'Three-putts from long range'],
  standard: ['Short-side misses leave no shot', 'Going at tucked pins'],
  advanced: ['Wedge distance control inside 120'],
};
const SEEDED_STRENGTH: Record<CoachingComplexity, string[]> = {
  simple: [],
  standard: ['You can hit the club you pick'],
  advanced: ['You can flight a shot to a number'],
};
/**
 * In-play cues by level. A beginner needs "don't decelerate" every round; an advanced player finds
 * it insulting. Terrain cues are here because the app finally knows terrain — elevation on the shot
 * and front/back depth on the green.
 */
const SEEDED_CUES: Record<CoachingComplexity, string[]> = {
  simple: [
    'Chip: accelerate through it — deceleration is the chunk',
    'Read the slope before the line — uphill putts break less',
    'Take one more club than you think and swing easy',
  ],
  standard: [
    'Downhill putts run — start it slower than it looks',
    'Miss to the fat side of the green, not the pin',
  ],
  advanced: [
    'Downhill and downwind compound — take less club than the number says',
  ],
};

const finding = (text: string, source: FindingSource): PlayFinding => ({ text, source });

export function composePlayProfile(input: PlayProfileInput): PlayProfile {
  const level = input.level;
  const goal: RoundGoal = input.goal ?? 'free_play';
  const par = typeof input.coursePar === 'number' && input.coursePar > 0 ? input.coursePar : 72;
  const holeCount = typeof input.courseHoles === 'number' && input.courseHoles > 0
    ? Math.round(input.courseHoles)
    : STANDARD_HOLES;
  const absolute = TARGET[goal];
  const overPar = OVER_PAR[goal];
  const { targetScore, strokeBudget } = holeCount === STANDARD_HOLES
    ? { targetScore: absolute, strokeBudget: absolute == null ? null : absolute - par }
    : (() => {
        const budget = overPar == null ? null : Math.round((overPar * holeCount) / STANDARD_HOLES);
        return { targetScore: budget == null ? null : par + budget, strokeBudget: budget };
      })();

  const strengths: PlayFinding[] = [];
  const weaknesses: PlayFinding[] = [];

  // ── MEASURED FIRST. A real observation always outranks a prior about the player's level. ──
  const rounds = input.roundsPlayed ?? 0;
  const measuredEnough = rounds >= 2;

  if (measuredEnough && typeof input.penaltiesPerRound === 'number') {
    if (input.penaltiesPerRound >= 3) {
      weaknesses.push(finding(`Penalties — ${Math.round(input.penaltiesPerRound)} a round is ${Math.round(input.penaltiesPerRound)} shots you can just not take`, 'measured'));
    } else if (input.penaltiesPerRound <= 0.5) {
      strengths.push(finding('You keep the ball in play', 'measured'));
    }
  }
  if (measuredEnough && typeof input.puttsPerRound === 'number') {
    if (input.puttsPerRound >= 36) weaknesses.push(finding(`Putting — ${Math.round(input.puttsPerRound)} a round`, 'measured'));
    else if (input.puttsPerRound <= 30) strengths.push(finding('You putt well', 'measured'));
  }
  if (input.dominantMiss === 'left' || input.dominantMiss === 'right') {
    weaknesses.push(finding(`Your miss is ${input.dominantMiss} — aim away from trouble on that side`, 'measured'));
  }
  if (typeof input.bagGapCount === 'number' && input.bagGapCount >= 2) {
    weaknesses.push(finding(`${input.bagGapCount} real gaps in your set — some numbers have no full swing`, 'measured'));
  }
  if (input.distanceControl === 'full_swings') {
    weaknesses.push(finding('In-between yardages — you swing full, so the number has to fit a club', 'measured'));
  } else if (input.distanceControl === 'dial_down') {
    strengths.push(finding('You can dial a club down to a number', 'measured'));
  }

  // ── SEEDED FILL. Only where measurement has not spoken, and always labelled. ──
  for (const w of SEEDED_WEAKNESS[level]) {
    if (weaknesses.length >= 3) break;
    weaknesses.push(finding(w, 'seeded'));
  }
  for (const st of SEEDED_STRENGTH[level]) {
    if (strengths.length >= 2) break;
    strengths.push(finding(st, 'seeded'));
  }

  const cues = SEEDED_CUES[level].map((c) => finding(c, 'seeded'));

  const all = [...strengths, ...weaknesses];
  const anyMeasured = all.some((f) => f.source === 'measured');
  const anySeeded = all.some((f) => f.source === 'seeded');
  const confidence: PlayProfile['confidence'] =
    anyMeasured && anySeeded ? 'mixed' : anyMeasured ? 'measured' : 'seeded';

  return { level, goal, targetScore, strokeBudget, holeCount, strengths, weaknesses, cues, confidence };
}

/**
 * The bogey-math line — the lens itself, stated plainly.
 *
 * Tim: "you can do seventeen bogeys and one par, and you break ninety." Said as strokes IN HAND, not
 * as a deficit, because the whole point is that a double is not a disaster when the budget absorbs
 * it. Returns null for free play, where there is no target to be over or under.
 */
export function bogeyBudgetLine(
  profile: PlayProfile,
  strokesOverPar: number | null,
  holesPlayed: number,
): string | null {
  if (profile.strokeBudget == null) return null;
  /**
   * 2026-09-11 — THE HOLE COUNT COMES FROM THE PROFILE, NOT FROM THE NUMBER 18.
   *
   * This said `18 - holesPlayed` and rejected anything past 18. On a nine-hole round it told a man
   * on his third hole how many holes he had left out of eighteen — fifteen holes that were never
   * going to be played. The count belongs to the round, and the profile is what knows the round.
   */
  const total = profile.holeCount > 0 ? profile.holeCount : 18;
  if (strokesOverPar == null || holesPlayed <= 0 || holesPlayed > total) return null;
  const remaining = profile.strokeBudget - strokesOverPar;
  if (remaining < 0) return `${Math.abs(remaining)} over the ${profile.targetScore} pace — par two of these and you're back`;
  const holesLeft = total - holesPlayed;
  if (holesLeft <= 0) return null;
  return `${remaining} shots in hand for ${holesLeft} hole${holesLeft === 1 ? '' : 's'} — bogey them all and you still come in at ${(profile.targetScore ?? 0) + 1} or better`;
}

/**
 * Which cues to actually say right now.
 *
 * A reminder that fires every time is nagging, which this app refuses outright
 * ([[no-push-nagging-no-ads]]), and a cue the player has already acted on is worse than silence —
 * it reads as not paying attention. So cues DECAY: the caller passes how many times each has
 * already been said this round, and anything said twice stays quiet.
 */
export function cuesFor(profile: PlayProfile, saidCounts: Record<string, number> = {}, max = 1): PlayFinding[] {
  return profile.cues.filter((c) => (saidCounts[c.text] ?? 0) < 2).slice(0, max);
}
