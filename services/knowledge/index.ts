/**
 * 2026-06-04 — Tank knowledge barrel.
 *
 * Single import surface for downstream consumers (Tank intent handler,
 * Coach Mode, SwingLab analysis surfaces, future avatar coaching, future
 * conversational coaching).
 *
 * NON-REGRESSION: nothing in this directory mutates existing behavior.
 * All exports are data + pure helpers Tank can OPTIONALLY consult when
 * relevant context is available. Existing pipelines (api/swing-analysis,
 * api/cage-coach, services/patternEngine) continue producing the same
 * outputs they always have.
 */

// Biomechanics elite reference values + comparison engine.
export {
  BIOMECHANICS_REFERENCE_VALUES,
  getReference,
} from './biomechanics/biomechanicsReferenceValues';
export {
  BIOMECHANICS_PRIORITIES,
  priorityFor,
} from './biomechanics/biomechanicsPriorities';
export {
  compareToElite,
  compareAndRank,
  renderComparison,
} from './biomechanics/biomechanicsComparison';
export type {
  SwingPosition,
  BiomechCategory,
  BiomechReference,
  BiomechReferenceMap,
  BiomechComparison,
  BiomechMeasurement,
  PriorityEntry,
  NumericRange,
} from './biomechanics/types';

// Golf Father — alignment optical-illusion intelligence.
export {
  FADE_ALIGNMENT_PRINCIPLE,
  ALIGNMENT_FAILURE_SEQUENCE,
  DRAW_VS_FADE_INTELLIGENCE,
  ALIGNMENT_TRUST_INDICATORS,
  evaluateAlignmentVsSwingFault,
  COACHING_RESPONSE_TEMPLATE,
  buildAlignmentPromptBlock,
} from './golfFather/opticalIllusionFadeAlignment';
export type {
  AlignmentSignalKey,
  AlignmentDiagnosisInput,
  AlignmentDiagnosisResult,
} from './golfFather/opticalIllusionFadeAlignment';
