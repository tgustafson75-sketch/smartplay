/**
 * 2026-06-13 — Practice Session Runner: focus catalog + interleaving planner.
 *
 * Tim: a session should KNOW what today is — irons, short game, hands, driver (and
 * within driver, distance vs speed). Tank: the worst way to learn is 60 balls with
 * one club; switch clubs, change targets, "play a course in your mind." This encodes
 * both: each focus prescribes which clubs to rotate and what to watch, and the
 * planner lays out an INTERLEAVED sequence (small blocks, rotating clubs/targets)
 * instead of a blocked grind — the structure that actually transfers to the course.
 *
 * Pure / sync / never-throws. The output is neutral structure; Tank VOICES the cues
 * at delivery (the persona layer), and the honest per-rep read comes from
 * composeSmartTrace + summarizeOpenRange. Honesty: a focus only claims feedback we
 * can actually give (start direction, tempo, contact, ESTIMATED ball speed) — never
 * radar-grade clubhead speed we don't measure (memory face-smash-fps-future,
 * smartmotion-metrics-honesty). See memory practice-engine-smartmotion.
 */

export type FocusEmphasis = 'start_direction' | 'tempo' | 'contact' | 'speed';
export type FocusView = 'down_the_line' | 'face_on';

export interface PracticeFocus {
  key: string;
  label: string;
  /** Clubs this focus rotates through (>1 → club interleaving; 1 → target interleaving). */
  clubs: string[];
  /** Swings on a club before rotating — small, to interleave rather than grind. */
  blockSize: number;
  view: FocusView;
  /** What the read emphasizes — must be something we can actually measure. */
  emphasis: FocusEmphasis;
  /** Neutral one-line intent (Tank voices it at delivery). */
  intent: string;
}

export const PRACTICE_FOCUSES: PracticeFocus[] = [
  {
    key: 'irons',
    label: 'Irons',
    clubs: ['7I', '9I', '5I', '8I'],
    blockSize: 2,
    view: 'down_the_line',
    emphasis: 'start_direction',
    intent: 'Groove your strike and start line — rotate clubs so it transfers, not a one-club groove.',
  },
  {
    key: 'short_game',
    label: 'Short game',
    clubs: ['PW', 'GW', 'SW'],
    blockSize: 2,
    view: 'down_the_line',
    emphasis: 'contact',
    intent: 'Vary the carry every few balls — feel different distances instead of one stock wedge.',
  },
  {
    key: 'driver_distance',
    label: 'Driver — distance',
    clubs: ['Driver'],
    blockSize: 3,
    view: 'down_the_line',
    emphasis: 'start_direction',
    intent: 'Pick a target and commit — change your aim point so you practice shaping, not just bombing.',
  },
  {
    key: 'driver_speed',
    label: 'Driver — speed',
    clubs: ['Driver'],
    blockSize: 3,
    view: 'down_the_line',
    emphasis: 'speed',
    intent: 'Train speed in short bursts (overspeed reps). Honest: we read tempo + estimated ball speed, not radar.',
  },
  {
    key: 'hands_transition',
    label: 'Hands / transition',
    clubs: ['7I', 'Driver'],
    blockSize: 2,
    view: 'down_the_line',
    emphasis: 'tempo',
    intent: 'Feel the transition — tempo over force. Alternate a control club and the driver.',
  },
  {
    key: 'putting',
    label: 'Putting',
    clubs: ['Putter'],
    blockSize: 4,
    view: 'face_on',
    emphasis: 'contact',
    intent: 'Start line and speed control — change the distance often, not the same putt on repeat.',
  },
];

export function getFocus(key: string): PracticeFocus | null {
  return PRACTICE_FOCUSES.find((f) => f.key === key) ?? null;
}

export interface PracticeRep {
  index: number;
  club: string;
  /** Block ordinal (a run of same-club reps). */
  block: number;
  /** True on the first rep after a club change — the "switch" cue. */
  switchClub: boolean;
  /** A rotating target nudge so the player doesn't aim at the same spot every ball. */
  targetCue: string;
}

/** Target cues rotate per block so practice stays varied even on a one-club focus. */
const TARGET_CUES = [
  'pick a specific target',
  'move your aim — different target',
  'shorter target this block',
  'longer target this block',
  'tighten the window',
];

/**
 * Build an interleaved sequence of reps for a focus. Multi-club focuses rotate
 * clubs every `blockSize` reps (club interleaving); single-club focuses keep the
 * club but rotate the TARGET each block (target interleaving). Either way it never
 * lays out one long blocked grind.
 */
export function buildInterleavedPlan(focus: PracticeFocus, totalReps: number): PracticeRep[] {
  const reps: PracticeRep[] = [];
  const clubs = focus.clubs.length > 0 ? focus.clubs : ['7I'];
  const blockSize = Math.max(1, focus.blockSize);
  const n = Math.max(0, Math.floor(totalReps));

  let block = 0;
  let prevClub: string | null = null;
  for (let i = 0; i < n; i++) {
    block = Math.floor(i / blockSize);
    const club = clubs[block % clubs.length];
    reps.push({
      index: i,
      club,
      block,
      switchClub: club !== prevClub,
      targetCue: TARGET_CUES[block % TARGET_CUES.length],
    });
    prevClub = club;
  }
  return reps;
}

/**
 * Quick integrity check used by the runner/tests: does a plan actually interleave
 * (no single club used for the whole session when the focus offers more than one)?
 */
export function isInterleaved(plan: PracticeRep[], focus: PracticeFocus): boolean {
  if (plan.length === 0) return true;
  const distinctClubs = new Set(plan.map((r) => r.club)).size;
  if (focus.clubs.length > 1) return distinctClubs > 1; // multi-club → must rotate clubs
  // Single-club focus interleaves via target cues instead.
  const distinctCues = new Set(plan.map((r) => r.targetCue)).size;
  return plan.length <= focus.blockSize || distinctCues > 1;
}
