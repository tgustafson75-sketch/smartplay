/**
 * 2026-09-13 (Tim, reviewing the dashboard) — the PROGRESS card read
 *
 *     "Steady stretch — a bump in focused practice tends to move the scoring line."
 *
 * while the label on its own practice line read PRACTICE 0 balls.
 *
 * THE CARD HAD NO WORD FOR "YOU STOPPED".
 *
 * Three services — practiceImpact, pointsPerformance, workoutPerformance — each ended their headline
 * switch with the same shape:
 *
 *     if (effortUp && scoreImproving) …
 *     else if (effortUp && scoreWorse) …
 *     else if (effortUp)              …
 *     else if (scoreImproving)        …
 *     else                            'Steady stretch — a bump in … tends to move the scoring line.'
 *
 * Every branch is about effort going UP. The final `else` therefore absorbs two completely different
 * situations: effort genuinely flat, and effort that FELL OFF A CLIFF. Both were reported as a steady
 * stretch, with advice to add "a bump" of the very thing the player had already stopped doing. Each
 * service had already computed both halves of the effort window and could see the drop; none of them
 * had a sentence for it. The one number on the card that could have contradicted the headline — the
 * 0 at the end of the effort line — was sitting right underneath it.
 *
 * That is the same failure as a stat with no source: the app said something it had not measured, and
 * declined to say the thing it had. [[a-confident-sentence-the-data-does-not-support]]
 *
 * WHY THIS IS A MODULE AND NOT THREE FIXES. The branching is the thing that was wrong, identically,
 * in three places. `EffortScoreVerdict` is a nine-member union and the copy map is a
 * `Record<EffortScoreVerdict, …>`, so an unwritten case is a COMPILE ERROR rather than a silent
 * fall-through into a wrong sentence. The bug is not reachable from here.
 * [[two-owners-is-the-root-cause]]
 */

/** Which way the EFFORT went across the window. */
export type EffortDirection = 'up' | 'down' | 'flat';
/** Which way the OUTCOME went. Named from the player's point of view, not the axis's. */
export type ScoreDirection = 'improving' | 'worse' | 'holding';
export type EffortScoreVerdict = `${EffortDirection}_${ScoreDirection}`;

/**
 * A 10% deadband, so a week's ordinary wobble is not reported as a trend. Without it "flat" means
 * exactly-equal sums, which essentially never happens, and every real window would claim a
 * direction — the mirror of the bug above.
 */
export const EFFORT_DEADBAND = 0.1;

export function effortDirection(early: number, late: number): EffortDirection {
  const a = Number.isFinite(early) ? early : 0;
  const b = Number.isFinite(late) ? late : 0;
  const scale = Math.max(Math.abs(a), Math.abs(b));
  if (scale === 0) return 'flat';
  if (Math.abs(b - a) / scale <= EFFORT_DEADBAND) return 'flat';
  return b > a ? 'up' : 'down';
}

export function scoreDirection(improving: boolean, worse: boolean): ScoreDirection {
  if (improving) return 'improving';
  if (worse) return 'worse';
  return 'holding';
}

export function verdictOf(input: {
  effortEarly: number;
  effortLate: number;
  scoreImproving: boolean;
  scoreWorse: boolean;
}): EffortScoreVerdict {
  return `${effortDirection(input.effortEarly, input.effortLate)}_${scoreDirection(input.scoreImproving, input.scoreWorse)}`;
}

/** Per-source nouns. The honesty is shared; the vocabulary is not. */
export interface EffortVoice {
  /** Sentence-initial subject: "Your practice", "Your practice points", "Your training volume". */
  subject: string;
  /** Mid-sentence, lower case: "practice", "practice points", "training". */
  noun: string;
  /** What the effort number counts: "balls", "points", "sessions". Omitted from copy when blank. */
  unit: string;
  /** What to do when effort is up and the score has not moved yet. "keep stacking the reps". */
  holdAdvice: string;
  /** What the work needs when the score went the wrong way. "give the work time to transfer". */
  transferNote: string;
}

/** The measured numbers the sentence is allowed to quote. */
export interface EffortFacts {
  effortEarly: number;
  effortLate: number;
}

const amount = (n: number, unit: string): string => {
  const v = Math.round(n);
  return unit ? `${v} ${unit}` : String(v);
};

/**
 * Every one of the nine outcomes, said out loud. Nothing here claims the practice CAUSED the score —
 * the verbs are "showing up", "tracked", "went with" — and every sentence that describes a change
 * quotes the two numbers it measured it from, so the player can check the claim against the chart
 * he is looking at.
 */
const COPY: Record<EffortScoreVerdict, (v: EffortVoice, f: EffortFacts) => string> = {
  up_improving: (v) => `${v.subject} is up and your scores are trending down — it's showing up on the course.`,
  up_worse: (v) => `${v.noun[0].toUpperCase()}${v.noun.slice(1)} is up but scores ticked the wrong way — ${v.transferNote}.`,
  up_holding: (v) => `${v.subject} is up; scores are holding steady — ${v.holdAdvice}.`,

  // The three cases the old `else` was swallowing. Each one names the drop.
  down_improving: (v, f) =>
    `${v.subject} dropped off — ${amount(f.effortEarly, v.unit)} down to ${amount(f.effortLate, v.unit)} — and your scores held up anyway. Worth knowing what carried you.`,
  down_worse: (v, f) =>
    `${v.subject} dropped off — ${amount(f.effortEarly, v.unit)} down to ${amount(f.effortLate, v.unit)} — and scores went with it. That is the clearest signal on this card.`,
  down_holding: (v, f) =>
    `${v.subject} dropped off — ${amount(f.effortEarly, v.unit)} down to ${amount(f.effortLate, v.unit)}. Scores have not moved yet; they usually follow.`,

  flat_improving: (v) => `Scores are trending down — nice. More ${v.noun} would help it stick.`,
  flat_worse: (v) => `Scores ticked the wrong way on flat ${v.noun}. ${v.holdAdvice[0].toUpperCase()}${v.holdAdvice.slice(1)}.`,
  flat_holding: (v) => `Steady stretch — a bump in ${v.noun} tends to move the scoring line.`,
};

export function effortScoreHeadline(facts: EffortFacts & { scoreImproving: boolean; scoreWorse: boolean }, voice: EffortVoice): string {
  return COPY[verdictOf(facts)](voice, facts);
}
