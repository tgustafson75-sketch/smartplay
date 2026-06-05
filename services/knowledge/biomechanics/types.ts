/**
 * 2026-06-04 — Biomechanics reference shapes.
 *
 * These types describe elite-player reference RANGES (not hard rules,
 * not pass/fail). They are consumed by `biomechanicsComparison.ts` to
 * generate Tank-voice coaching strings of the shape:
 *
 *   Movement Pattern → Cause → Ball Flight Effect → Strike Effect → Outcome
 *
 * Non-regression: nothing here replaces existing scoring, PrimaryIssue
 * detection, or pose analysis. This is a comparison layer Tank can
 * optionally consult when measured biomechanics are available.
 */

/** Six positions Tank reasons about in order through the swing. */
export type SwingPosition =
  | 'address'
  | 'p4_top'       // Top of swing
  | 'p5'           // Lead arm parallel
  | 'p6'           // Shaft parallel
  | 'impact'
  | 'finish';

/** Categories the reference library covers. Not every position has
 *  every category — see `BIOMECHANICS_REFERENCE_VALUES`. */
export type BiomechCategory =
  | 'pelvis_rotation'
  | 'chest_rotation'
  | 'x_factor'
  | 'forward_bend'
  | 'side_bend'
  | 'pelvic_tilt'
  | 'knee_flex'
  | 'weight_transfer'
  | 'head_position'
  | 'arm_depth'
  | 'lead_arm_position'
  | 'shaft_pitch'
  | 'wrist_conditions';

/** A numeric range in the category's native unit (degrees for rotations,
 *  percent for weight, etc). Both bounds optional so partially-defined
 *  references work (e.g. "neutral" with no numbers). */
export interface NumericRange {
  min?: number;
  max?: number;
  unit: 'degrees' | 'percent_lead' | 'percent_trail' | 'qualitative';
}

/** A single reference entry — either a numeric range or a qualitative
 *  descriptor (e.g. "Neutral", "Stable", "Fully loaded"). Both fields
 *  may coexist when a numeric reference also benefits from a verbal cue. */
export interface BiomechReference {
  /** Human-readable label suitable for direct inclusion in Tank's reply. */
  label: string;
  /** Numeric range when the category is measurable. Omit for qualitative. */
  range?: NumericRange;
  /** Coaching note appended verbatim to the comparison output. */
  note?: string;
}

/** Full reference map: position → category → reference. Categories
 *  absent for a position are intentional (no elite reference exists
 *  or isn't meaningful at that checkpoint). */
export type BiomechReferenceMap = {
  [P in SwingPosition]: Partial<Record<BiomechCategory, BiomechReference>>;
};

/** Coaching-priority weight: Tank treats higher-priority categories as
 *  the headline observation when multiple deviations are present. NOT a
 *  scoring weight — it only controls which finding Tank leads with. */
export interface PriorityEntry {
  category: BiomechCategory | 'head_stability' | 'pelvis_distance_from_ball';
  rank: 1 | 2 | 3 | 4 | 5;
  label: string;
  trackingNotes: string;
  coachingConnections: string[];
}

/** Output shape of `compareToElite`. Each field is a complete sentence
 *  in Tank's voice so callers can concatenate without rewriting. */
export interface BiomechComparison {
  observation: string;
  comparison: string;
  impact: string;
  outcome: string;
  /** Higher rank = lead with this in the coaching reply. */
  coachingPriority: 1 | 2 | 3 | 4 | 5;
}

/** Input to `compareToElite`. `measured` is the numeric value in the
 *  same unit as the reference range; `qualitative` is the verbal cue
 *  for non-numeric categories ("stable" / "drifted forward" / etc). */
export interface BiomechMeasurement {
  position: SwingPosition;
  category: BiomechCategory;
  measured?: number;
  qualitative?: string;
}
