/**
 * 2026-08-22 (Tim — "we wanna have a data point to see if working out towards that swing is also
 * touching or helping"). OWNER-ONLY for now: SmartPump is Tim's, so he is the only person this
 * currently answers for. Gated at the surface, not here — this stays a pure function.
 *
 * The existing training rail ([[services/practice/workoutPerformance.ts]]) asks whether the gym work
 * shows up in SCORING. This asks the sharper question one layer in: does it show up in the SWING.
 *
 * Why that is the better question for this signal. Scoring is slow and noisy — putting, course,
 * weather and luck all sit between a deadlift and a number on a card, and it needs four rounds before
 * it will say anything. Strike quality moves faster, needs only range sessions, and is far closer to
 * what the exercises are actually aimed at: the fault-driven workouts are selected FOR the dominant
 * miss, so if they are working at all, contact is where it should surface first.
 *
 * Same honesty bar as every other rail here: pure, sync, never throws, quiet until there is enough on
 * BOTH sides, and it describes ASSOCIATION, never causation. A training week and a striking week
 * moving together is a thing worth seeing; it is not proof that one caused the other, and the copy
 * never says it is.
 */

export interface WorkoutSwingImpactInput {
  /** Imported workouts: a date + optional duration. */
  workouts: { date: number; durationMin: number | null }[];
  /**
   * The golfer's OWN swing sessions. `clean` is the number of shots read as a clean strike and
   * `graded` the number we could read at all — unknown reads are excluded from both, so a session
   * the vision pass could not grade lowers neither the rate nor the confidence in it.
   */
  sessions: { date: number; clean: number; graded: number }[];
  nowMs: number;
}

export interface WorkoutSwingImpact {
  /** Training volume per week, oldest→newest. */
  workoutSeries: number[];
  /** Strike rate (0-100) per week, oldest→newest. Weeks with no graded swings are 0. */
  strikeSeries: number[];
  /** Which weeks actually had graded swings — a 0 from "no range time" is not a 0% strike rate. */
  strikeWeekHasData: boolean[];
  metric: 'minutes' | 'sessions';
  totalWorkouts: number;
  totalGradedSwings: number;
  weeksWithBoth: number;
  /** Enough on BOTH sides, in the SAME weeks, to say anything honest. */
  hasEnough: boolean;
  headline: string;
}

const WEEKS = 6;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_WORKOUTS = 3;
const MIN_GRADED_SWINGS = 20;
/**
 * Both sides have to be present in the SAME weeks or the two lines are describing different periods
 * and lining them up says nothing. This is the gate the scoring rail cannot really enforce, because
 * rounds are indexed by round rather than by week.
 */
const MIN_WEEKS_WITH_BOTH = 3;
/** Per-session fallback when a workout has no stated duration — matches the scoring rail. */
const ASSUMED_SESSION_MIN = 45;
/** Below this many graded swings a week's strike rate is too jumpy to plot honestly. */
const MIN_GRADED_PER_WEEK = 5;

export function computeWorkoutSwingImpact(input: WorkoutSwingImpactInput): WorkoutSwingImpact {
  const { workouts, sessions, nowMs } = input;

  // Every entry is treated as untrusted: these arrays come off persisted stores and an import that
  // parsed a PDF, and a single malformed row must never take the dashboard down.
  const validW = (workouts ?? []).filter((w) => !!w && typeof w.date === 'number' && Number.isFinite(w.date));
  const withDuration = validW.filter((w) => typeof w.durationMin === 'number' && w.durationMin! > 0).length;
  const metric: 'minutes' | 'sessions' =
    validW.length > 0 && withDuration >= Math.ceil(validW.length / 2) ? 'minutes' : 'sessions';

  const workoutSeries = new Array(WEEKS).fill(0) as number[];
  let totalWorkouts = 0;
  for (const w of validW) {
    totalWorkouts += 1;
    const ageWeeks = Math.floor((nowMs - w.date) / WEEK_MS);
    if (ageWeeks < 0 || ageWeeks >= WEEKS) continue; // counts toward the total, not the 6wk chart
    const mins = typeof w.durationMin === 'number' && w.durationMin > 0 ? w.durationMin : ASSUMED_SESSION_MIN;
    workoutSeries[WEEKS - 1 - ageWeeks] += metric === 'minutes' ? mins : 1;
  }

  // Strike rate is pooled per week rather than averaged across sessions, so a 3-swing session cannot
  // swing the week as hard as a 60-swing one.
  const cleanPerWeek = new Array(WEEKS).fill(0) as number[];
  const gradedPerWeek = new Array(WEEKS).fill(0) as number[];
  let totalGradedSwings = 0;
  for (const s of sessions ?? []) {
    if (!s || typeof s.date !== 'number' || !Number.isFinite(s.date)) continue;
    const graded = typeof s.graded === 'number' && s.graded > 0 ? s.graded : 0;
    if (!graded) continue;
    const clean = typeof s.clean === 'number' && s.clean >= 0 ? Math.min(s.clean, graded) : 0;
    totalGradedSwings += graded;
    const ageWeeks = Math.floor((nowMs - s.date) / WEEK_MS);
    if (ageWeeks < 0 || ageWeeks >= WEEKS) continue;
    cleanPerWeek[WEEKS - 1 - ageWeeks] += clean;
    gradedPerWeek[WEEKS - 1 - ageWeeks] += graded;
  }

  const strikeWeekHasData = gradedPerWeek.map((g) => g >= MIN_GRADED_PER_WEEK);
  const strikeSeries = gradedPerWeek.map((g, i) =>
    strikeWeekHasData[i] ? Math.round((cleanPerWeek[i] / g) * 100) : 0,
  );

  const weeksWithBoth = strikeWeekHasData.reduce(
    (n, hasSwings, i) => n + (hasSwings && workoutSeries[i] > 0 ? 1 : 0),
    0,
  );
  const hasEnough =
    totalWorkouts >= MIN_WORKOUTS &&
    totalGradedSwings >= MIN_GRADED_SWINGS &&
    weeksWithBoth >= MIN_WEEKS_WITH_BOTH;

  let headline: string;
  if (!hasEnough) {
    const needW = Math.max(0, MIN_WORKOUTS - totalWorkouts);
    const needS = Math.max(0, MIN_GRADED_SWINGS - totalGradedSwings);
    const needBoth = Math.max(0, MIN_WEEKS_WITH_BOTH - weeksWithBoth);
    // Say exactly what is missing. A blank card reads as broken, and "not enough data" without a
    // number is the same as no answer at all.
    const parts: string[] = [];
    if (needW > 0) parts.push(`${needW} more workout${needW === 1 ? '' : 's'}`);
    if (needS > 0) parts.push(`${needS} more graded swing${needS === 1 ? '' : 's'}`);
    if (!parts.length && needBoth > 0) {
      parts.push(`${needBoth} more week${needBoth === 1 ? '' : 's'} with both training and range time`);
    }
    headline = parts.length
      ? `Need ${parts.join(' and ')} before this can say anything honest.`
      : 'Keep training and hitting — this fills in as both sides build up.';
  } else {
    const half = Math.ceil(WEEKS / 2);
    const firstHalfTraining = workoutSeries.slice(0, half).reduce((a, b) => a + b, 0);
    const lastHalfTraining = workoutSeries.slice(half).reduce((a, b) => a + b, 0);
    const trainingUp = lastHalfTraining > firstHalfTraining;

    // Only compare weeks that actually carry a strike rate, so an off week is not read as a collapse.
    const early = strikeSeries.filter((_, i) => i < half && strikeWeekHasData[i]);
    const late = strikeSeries.filter((_, i) => i >= half && strikeWeekHasData[i]);
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    const earlyAvg = avg(early);
    const lateAvg = avg(late);
    const delta = earlyAvg != null && lateAvg != null ? Math.round(lateAvg - earlyAvg) : null;

    if (delta == null) {
      headline = 'Not enough striking weeks on both sides of the window to compare yet.';
    } else if (trainingUp && delta >= 4) {
      headline = `Training is up and your strike rate is up ${delta} points with it — the gym work is showing in the contact.`;
    } else if (trainingUp && delta <= -4) {
      headline = `Training is up but strike quality is down ${Math.abs(delta)} points. Often fatigue rather than a swing problem — check what your striking looks like on rest days.`;
    } else if (trainingUp) {
      headline = 'Training is up and your striking is holding steady — no cost to the swing so far, which is what you want early.';
    } else if (delta >= 4) {
      headline = `Strike rate is up ${delta} points on lighter training — the swing work is carrying it right now.`;
    } else {
      headline = 'Training and striking are both steady. A change on either side is what makes this line worth reading.';
    }
  }

  return {
    workoutSeries,
    strikeSeries,
    strikeWeekHasData,
    metric,
    totalWorkouts,
    totalGradedSwings,
    weeksWithBoth,
    hasEnough,
    headline,
  };
}
