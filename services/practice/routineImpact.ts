/**
 * DOES YOUR ROUTINE ACTUALLY WORK? — the question, answered from the player's own shots.
 *
 * 2026-08-24 (Tim — "this would be great if user knows if shots are verifiably better when doing
 * their routine").
 *
 * Every golf app and every coach TELLS players to have a pre-shot routine. None of them ever shows
 * that golfer their own evidence. This does: it compares the strikes on the shots where they took
 * their time over the ball against the shots where they stepped up and hit it.
 *
 * THE SIGNAL COSTS NOTHING NEW. services/shotDetectionService has always measured how long the
 * player stood still at the ball — it must, because stillness is what identifies a shot at all —
 * and threw the number away every time. It is now carried on the shot as `pre_shot_dwell_ms`.
 * [[the-app-usually-already-knows]]
 *
 * HONESTY, and it is most of this file:
 *  - SELF-RELATIVE, never a universal number. There is no correct number of seconds over a golf
 *    ball; a fast player's routine is not a slow player's. So it contrasts the player's OWN slowest
 *    third against their OWN quickest third, and ignores the middle, where the contrast is mush.
 *  - QUIET until both ends carry enough graded shots to mean anything. A rate over four strikes is
 *    not a finding, it is noise with a percent sign.
 *  - ASSOCIATION, NEVER CAUSATION. Standing longer over an easy pitch and shorter over a forced
 *    driver would produce this pattern with no routine involved at all. The copy says "on the shots
 *    where…", not "because you…".
 *  - A NULL RESULT IS A RESULT. When the two ends are within a few points it says so plainly rather
 *    than dressing noise as a win. If the routine is not showing up, the player deserves that.
 *  - The clean-strike definition is IMPORTED from services/adviceOutcome, not restated.
 *
 * Pure, synchronous, never throws — same contract as workoutSwingImpact, which this mirrors.
 */
import { CLEAN_CONTACT } from '../adviceOutcome';

export type RoutineShot = {
  /** Milliseconds the player was stationary over the ball. Null = not measured on this shot. */
  pre_shot_dwell_ms?: number | null;
  /** The strike read. Only graded strikes count; an ungraded shot is excluded from BOTH ends. */
  feel?: string | null;
};

export type RoutineImpact =
  | { status: 'quiet'; reason: string }
  | {
      status: 'ready';
      /** Clean-strike rate (%) on the player's slowest third over the ball. */
      unhurriedPct: number;
      /** Clean-strike rate (%) on their quickest third. */
      rushedPct: number;
      /** unhurriedPct − rushedPct. Positive = better when they took their time. */
      deltaPct: number;
      unhurriedShots: number;
      rushedShots: number;
      /** Median seconds over the ball in each group — what "taking your time" means FOR THEM. */
      unhurriedMedianSec: number;
      rushedMedianSec: number;
      /** The one line to show the player. */
      line: string;
    };

/** Both ends need this many graded shots before a rate is worth printing. */
export const MIN_PER_GROUP = 12;
/** Below this the two ends are the same thing and saying otherwise would be dressing up noise. */
export const MEANINGFUL_DELTA_PCT = 5;

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  return m;
};
const rate = (shots: RoutineShot[]): number =>
  shots.length === 0 ? 0 : Math.round((shots.filter(s => CLEAN_CONTACT.has(String(s.feel))).length / shots.length) * 100);

/**
 * Compare strike quality on the shots the player took their time over against the ones they rushed.
 * Returns a 'quiet' status — with the reason, in counts — whenever it cannot honestly answer.
 */
export function routineImpact(shots: readonly RoutineShot[]): RoutineImpact {
  const usable = (shots ?? []).filter(s =>
    typeof s?.pre_shot_dwell_ms === 'number' &&
    Number.isFinite(s.pre_shot_dwell_ms) &&
    (s.pre_shot_dwell_ms as number) > 0 &&
    !!s.feel,                       // ungraded strikes are excluded from BOTH ends, never counted as a miss
  ) as { pre_shot_dwell_ms: number; feel: string }[];

  const needed = MIN_PER_GROUP * 3;   // terciles: each end needs MIN, and the middle is discarded
  if (usable.length < needed) {
    return { status: 'quiet', reason: `${usable.length} of ${needed} timed shots with a graded strike` };
  }

  const sorted = [...usable].sort((a, b) => a.pre_shot_dwell_ms - b.pre_shot_dwell_ms);
  const cut = Math.floor(sorted.length / 3);
  const rushed = sorted.slice(0, cut);
  const unhurried = sorted.slice(sorted.length - cut);
  if (rushed.length < MIN_PER_GROUP || unhurried.length < MIN_PER_GROUP) {
    return { status: 'quiet', reason: `${Math.min(rushed.length, unhurried.length)} of ${MIN_PER_GROUP} in the smaller group` };
  }

  const unhurriedPct = rate(unhurried);
  const rushedPct = rate(rushed);
  const deltaPct = unhurriedPct - rushedPct;
  const unhurriedMedianSec = Math.round(median(unhurried.map(s => s.pre_shot_dwell_ms)) / 100) / 10;
  const rushedMedianSec = Math.round(median(rushed.map(s => s.pre_shot_dwell_ms)) / 100) / 10;

  const line = Math.abs(deltaPct) < MEANINGFUL_DELTA_PCT
    ? `No real difference so far — ${unhurriedPct}% clean when you take your time (about ${unhurriedMedianSec}s over it) against ${rushedPct}% when you step up quick. Your routine isn't showing up in the strike yet.`
    : deltaPct > 0
      ? `You strike it better when you take your time: ${unhurriedPct}% clean at about ${unhurriedMedianSec}s over the ball, against ${rushedPct}% at ${rushedMedianSec}s. That's ${deltaPct} points on the shots where you gave yourself the routine.`
      : `Interesting one — you strike it BETTER when you step up quick: ${rushedPct}% clean at about ${rushedMedianSec}s against ${unhurriedPct}% at ${unhurriedMedianSec}s. Standing over it longer may be costing you.`;

  return {
    status: 'ready', unhurriedPct, rushedPct, deltaPct,
    unhurriedShots: unhurried.length, rushedShots: rushed.length,
    unhurriedMedianSec, rushedMedianSec, line,
  };
}
