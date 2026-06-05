/**
 * 2026-06-04 — Biomechanics comparison engine.
 *
 * Pure function — given a measured value at a (position, category), it
 * returns a BiomechComparison whose four sentences follow the
 * Movement → Cause → Ball Flight → Strike → Outcome pattern in Tank's
 * voice.
 *
 * Tank should NEVER coach positions for the sake of positions. This
 * helper enforces the rule by always returning an `impact` and an
 * `outcome` sentence alongside the raw observation.
 *
 * Callers (Coach Mode, SwingLab post-analysis, future avatar) translate
 * the structured output into the surface's voice. The strings here are
 * deliberately written so they can be concatenated into a paragraph
 * without further rewriting.
 */

import type { BiomechMeasurement, BiomechComparison, BiomechReference } from './types';
import { getReference } from './biomechanicsReferenceValues';
import { priorityFor } from './biomechanicsPriorities';

type Verdict = 'below' | 'within' | 'above' | 'no_reference';

interface NumericVerdict {
  verdict: Verdict;
  /** Distance from the nearest range bound, in the unit of the range.
   *  0 when within. undefined when no reference. */
  delta?: number;
}

function evaluateNumeric(measured: number | undefined, ref: BiomechReference | undefined): NumericVerdict {
  if (!ref || !ref.range || measured == null) return { verdict: 'no_reference' };
  const { min, max } = ref.range;
  if (min == null && max == null) return { verdict: 'no_reference' };
  if (min != null && measured < min) return { verdict: 'below', delta: min - measured };
  if (max != null && measured > max) return { verdict: 'above', delta: measured - min! };
  return { verdict: 'within', delta: 0 };
}

const POSITION_LABEL: Record<BiomechMeasurement['position'], string> = {
  address: 'at address',
  p4_top:  'at the top of the swing',
  p5:      'at lead-arm parallel',
  p6:      'at shaft parallel',
  impact:  'at impact',
  finish:  'in the finish',
};

const CATEGORY_LABEL: Record<BiomechMeasurement['category'], string> = {
  pelvis_rotation:    'pelvis rotation',
  chest_rotation:     'chest (thorax) rotation',
  x_factor:           'X-factor (chest-pelvis separation)',
  forward_bend:       'forward bend',
  side_bend:          'side bend',
  pelvic_tilt:        'pelvic tilt',
  knee_flex:          'knee flex',
  weight_transfer:    'weight transfer',
  head_position:      'head position',
  arm_depth:          'arm depth',
  lead_arm_position:  'lead-arm position',
  shaft_pitch:        'shaft pitch',
  wrist_conditions:   'wrist conditions',
};

/** Generic impact/outcome lines per category. Tank's rule: never leave
 *  a comparison without a "why it matters" tail. */
const IMPACT_BY_CATEGORY: Partial<Record<BiomechMeasurement['category'], { impact: string; outcome: string }>> = {
  pelvis_rotation: {
    impact: 'Reduced pelvic rotation restricts space for the arms and the club through the hitting area.',
    outcome: 'Often contributes to blocks, hooks, and inconsistent strike quality.',
  },
  chest_rotation: {
    impact: 'When the chest under-rotates, the hands have to do more work to square the face.',
    outcome: 'Leads to timing-dependent ball flight — good days look great, bad days look erratic.',
  },
  x_factor: {
    impact: 'A low X-factor means little stretch between hips and chest, capping power output.',
    outcome: 'Distance ceiling drops and the swing feels arm-driven rather than body-driven.',
  },
  forward_bend: {
    impact: 'Losing forward bend in transition is the textbook early-extension signature.',
    outcome: 'Strike location migrates toward the heel; thin and toed shots become common.',
  },
  side_bend: {
    impact: 'Without trail-side bend at the top (or lead-side bend at impact), the swing path turns steep.',
    outcome: 'Tends to produce over-the-top patterns and pulls / pull-fades.',
  },
  weight_transfer: {
    impact: 'Trailing on the back foot delays low-point control and starves the strike of compression.',
    outcome: 'Fat strikes and high, weak ball flight are the common tells.',
  },
  head_position: {
    impact: 'Head drift reduces room for the arms to deliver the club along the intended path.',
    outcome: 'Strike location wanders shot-to-shot even when path and face look reasonable on tape.',
  },
  lead_arm_position: {
    impact: 'A disconnected lead arm makes the delivery position different on every swing.',
    outcome: 'Increases two-way miss patterns and makes ball-flight prediction unreliable.',
  },
  arm_depth: {
    impact: 'Arms too deep or too high at the top force a re-route to find the ball.',
    outcome: 'Compensations are timing-dependent — quality varies by feel rather than by structure.',
  },
  wrist_conditions: {
    impact: 'A cupped or excessively bowed lead wrist changes effective loft and face angle through impact.',
    outcome: 'Distance control and curvature become inconsistent across the bag.',
  },
};

function impactFor(category: BiomechMeasurement['category']) {
  return IMPACT_BY_CATEGORY[category] ?? {
    impact: `This deviation matters because ${CATEGORY_LABEL[category]} feeds directly into delivery position.`,
    outcome: 'Expect strike-quality variance until the pattern is addressed.',
  };
}

function priorityRank(category: BiomechMeasurement['category']): 1 | 2 | 3 | 4 | 5 {
  // Map the measurement category back onto Tank's coaching-priority list.
  // Head-position measurements ride on the head-stability priority (#1);
  // pelvis-distance is its own #2; everything else uses its direct category.
  if (category === 'head_position') return 1;
  const direct = priorityFor(category);
  return (direct?.rank as 1 | 2 | 3 | 4 | 5 | undefined) ?? 5;
}

/**
 * Build a Tank-voice comparison for one measurement. Returns null when
 * there is no elite reference for this (position, category) — callers
 * should skip the surface rather than render an empty card.
 */
export function compareToElite(input: BiomechMeasurement): BiomechComparison | null {
  const ref = getReference(input.position, input.category);
  if (!ref) return null;

  const where = POSITION_LABEL[input.position];
  const what = CATEGORY_LABEL[input.category];
  const elite = ref.label;
  const { impact, outcome } = impactFor(input.category);
  const rank = priorityRank(input.category);

  // Numeric path — measured value + numeric reference.
  if (typeof input.measured === 'number' && ref.range && ref.range.unit !== 'qualitative') {
    const verdict = evaluateNumeric(input.measured, ref);
    const unit = ref.range.unit === 'degrees' ? '°' :
                 ref.range.unit === 'percent_lead' ? '% lead' :
                 ref.range.unit === 'percent_trail' ? '% trail' : '';
    const observation = `Your ${what} measured ${input.measured}${unit} ${where}.`;
    const comparison = verdict.verdict === 'within'
      ? `That sits inside the typical elite range of ${elite}.`
      : `Elite players are commonly ${elite}.`;
    const elaboratedImpact = ref.note ? `${impact} ${ref.note}` : impact;
    return {
      observation,
      comparison,
      impact: verdict.verdict === 'within' ? `Position is sound — protect it.` : elaboratedImpact,
      outcome: verdict.verdict === 'within' ? `Keep building the rest of the chain around this checkpoint.` : outcome,
      coachingPriority: rank,
    };
  }

  // Qualitative path — verbal cue compared to a verbal reference.
  if (input.qualitative) {
    const observation = `${capitalize(input.qualitative)} ${where} on ${what}.`;
    const comparison = `Elite reference: ${elite}.`;
    return {
      observation,
      comparison,
      impact: ref.note ? `${impact} ${ref.note}` : impact,
      outcome,
      coachingPriority: rank,
    };
  }

  return null;
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Convenience renderer — turn a comparison into a single paragraph
 * suitable for direct injection into an LLM context block or for a
 * Coach Mode card. Concatenation order matches the Movement → Cause
 * → Ball Flight → Strike → Outcome philosophy.
 */
export function renderComparison(c: BiomechComparison): string {
  return `${c.observation} ${c.comparison} ${c.impact} ${c.outcome}`;
}

/**
 * Compare a batch of measurements and return them sorted with the
 * highest coaching priority first. Callers (Coach Mode, future avatar)
 * lead the conversation with index 0 and may drop the tail.
 */
export function compareAndRank(measurements: BiomechMeasurement[]): BiomechComparison[] {
  const compared = measurements
    .map(compareToElite)
    .filter((c): c is BiomechComparison => c !== null);
  return compared.sort((a, b) => a.coachingPriority - b.coachingPriority);
}
