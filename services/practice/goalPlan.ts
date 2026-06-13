/**
 * 2026-06-13 — Goal → weekly practice plan (Practice Engine, Tank's planner).
 *
 * Tank: "if you're trying to break 90, get better at putting for a tournament in 60
 * days — how many days a week can you practice? how many hours? do you have a range
 * or a putting green, or just carpet lines and a cocktail glass at home? — then it
 * breaks it down." This is that breakdown: a goal + your real constraints (days,
 * minutes, location, optional deadline) → a weighted weekly plan of focus sessions,
 * each one an interleaved block the Session Runner can drive.
 *
 * The weighting reflects where strokes actually live: scoring goals lean on short
 * game + putting (most amateurs' biggest leak), distance goals lean on speed. The
 * plan adapts to LOCATION — at home you only get putting + chipping, so it says so
 * rather than prescribing a range session you can't do.
 *
 * Pure / sync / never-throws. HONEST: it never promises an outcome ("you WILL break
 * 90") — it allocates practice to where it helps most and is explicit about what a
 * location limits. Tank voices it at delivery. See memory practice-engine-smartmotion,
 * and sessionPlan.ts for the focuses it references.
 */

import { PRACTICE_FOCUSES, getFocus } from './sessionPlan';

export type PracticeGoal =
  | 'break_100'
  | 'break_90'
  | 'break_80'
  | 'more_distance'
  | 'short_game'
  | 'tournament_prep';

export type PracticeLocation = 'full' | 'range_only' | 'putting_green' | 'home';

export interface GoalPlanInput {
  goal: PracticeGoal;
  /** Realistic sessions per week. */
  daysPerWeek: number;
  /** Minutes per session — scales reps. */
  minutesPerSession: number;
  /** What the player has access to. Filters which focuses are possible. */
  location: PracticeLocation;
  /** Optional event deadline, in days — adds urgency framing. */
  deadlineDays?: number | null;
}

export interface PlannedSession {
  day: number; // 1-based ordinal within the week's plan
  focusKey: string;
  focusLabel: string;
  reps: number;
}

export interface GoalPlan {
  goal: PracticeGoal;
  goalLabel: string;
  sessions: PlannedSession[];
  /** Honest framing + any location caveat. */
  notes: string[];
}

const GOAL_LABEL: Record<PracticeGoal, string> = {
  break_100: 'Break 100',
  break_90: 'Break 90',
  break_80: 'Break 80',
  more_distance: 'More distance',
  short_game: 'Sharpen short game',
  tournament_prep: 'Tournament prep',
};

// Relative weight per focus for each goal — where the strokes are.
const GOAL_WEIGHTS: Record<PracticeGoal, Record<string, number>> = {
  // Get it airborne + stop the blow-ups: contact + around the green.
  break_100: { irons: 3, short_game: 3, putting: 2, hands_transition: 1 },
  // Scoring zone wins here.
  break_90: { short_game: 3, putting: 3, irons: 2, hands_transition: 1 },
  // Refinement across the bag.
  break_80: { putting: 3, short_game: 2, irons: 2, driver_distance: 2, hands_transition: 1 },
  more_distance: { driver_speed: 3, driver_distance: 2, hands_transition: 2 },
  short_game: { short_game: 4, putting: 3 },
  tournament_prep: { putting: 3, short_game: 3, irons: 2, driver_distance: 1 },
};

// Which focuses are possible at each location.
const LOCATION_FOCUSES: Record<PracticeLocation, (key: string) => boolean> = {
  full: () => true,
  range_only: (k) => k !== 'putting', // a range mat: everything but green putting
  putting_green: (k) => k === 'putting' || k === 'short_game',
  home: (k) => k === 'putting' || k === 'short_game', // carpet line + a glass / chip net
};

const LOCATION_NOTE: Record<PracticeLocation, string | null> = {
  full: null,
  range_only: 'Range only — putting is left out. Grab 10 minutes on a green when you can.',
  putting_green: 'Putting green — short game and putting only this session type.',
  home: 'At home — carpet line for putting, a glass or towel target for chips. No full swings, but the scoring strokes are right here.',
};

function repsForMinutes(minutes: number): number {
  // ~1 quality ball every 90s including reset/feedback; floor/ceiling kept sane.
  const r = Math.round((Math.max(5, minutes) / 1.5));
  return Math.max(6, Math.min(40, r));
}

/**
 * Build a weekly plan: pick the goal's highest-weight focuses that the location
 * allows, then lay out `daysPerWeek` sessions INTERLEAVED across the week (no two
 * same-focus days back to back where avoidable), reps scaled to session length.
 */
export function buildGoalPlan(input: GoalPlanInput): GoalPlan {
  const { goal, daysPerWeek, minutesPerSession, location, deadlineDays } = input;
  const days = Math.max(1, Math.min(7, Math.floor(daysPerWeek)));
  const reps = repsForMinutes(minutesPerSession);

  // Focuses available for this goal + location, ordered by weight (desc).
  const weights = GOAL_WEIGHTS[goal] ?? {};
  const allowed = LOCATION_FOCUSES[location];
  const ranked = Object.entries(weights)
    .filter(([key]) => allowed(key) && !!getFocus(key))
    .sort((a, b) => b[1] - a[1])
    .map(([key]) => key);

  const notes: string[] = [];
  const locNote = LOCATION_NOTE[location];
  if (locNote) notes.push(locNote);

  // Nothing this location supports for this goal (e.g. "more distance" at home).
  if (ranked.length === 0) {
    notes.push(
      location === 'home'
        ? 'This goal needs full swings — at home, work putting and chipping instead, and save the range work for when you can get out.'
        : 'No matching practice for this goal at this location yet.',
    );
    return { goal, goalLabel: GOAL_LABEL[goal], sessions: [], notes };
  }

  // Allocate sessions across the week by weight, interleaving so the same focus
  // isn't two days running where there's more than one focus to rotate.
  const sessions: PlannedSession[] = [];
  let prev: string | null = null;
  for (let d = 0; d < days; d++) {
    let key = ranked[d % ranked.length];
    if (key === prev && ranked.length > 1) key = ranked[(d + 1) % ranked.length];
    const focus = getFocus(key)!;
    sessions.push({ day: d + 1, focusKey: key, focusLabel: focus.label, reps });
    prev = key;
  }

  // Deadline + honest framing.
  if (typeof deadlineDays === 'number' && deadlineDays > 0) {
    const weeks = Math.max(1, Math.round(deadlineDays / 7));
    notes.push(`${deadlineDays} days out (~${weeks} week${weeks === 1 ? '' : 's'}): ${days} session${days === 1 ? '' : 's'}/week, weighted to where you'll save the most strokes. Consistency over cramming.`);
  } else {
    notes.push(`${days} session${days === 1 ? '' : 's'}/week, weighted to where the strokes are for "${GOAL_LABEL[goal]}". No promises — just practice that points the right way.`);
  }

  return { goal, goalLabel: GOAL_LABEL[goal], sessions, notes };
}

/** The goals offered in the planner UI (stable order). */
export const PRACTICE_GOALS: { key: PracticeGoal; label: string }[] = (
  Object.keys(GOAL_LABEL) as PracticeGoal[]
).map((key) => ({ key, label: GOAL_LABEL[key] }));

// Touch PRACTICE_FOCUSES so a focus removed from the catalog surfaces here in review.
export const _focusCount = PRACTICE_FOCUSES.length;
