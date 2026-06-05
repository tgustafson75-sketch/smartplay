/**
 * 2026-06-04 — Elite-player reference ranges across six swing positions.
 *
 * Sources for the ranges are general teaching consensus (TPI / GEARS /
 * AMM 3D data summarized in popular instruction literature). They are
 * COMPARISON ANCHORS, not pass/fail thresholds — see comments at the
 * top of `types.ts`.
 *
 * Categories not present at a given position are intentional: e.g. P5
 * has no chest-rotation reference because the inflection happens later
 * in the downswing.
 */

import type { BiomechReferenceMap } from './types';

export const BIOMECHANICS_REFERENCE_VALUES: BiomechReferenceMap = {
  // ─── ADDRESS ───────────────────────────────────────────────────────
  address: {
    pelvis_rotation: { label: 'Neutral', range: { unit: 'qualitative' } },
    chest_rotation:  { label: 'Neutral', range: { unit: 'qualitative' } },
    x_factor:        { label: 'Near 0°', range: { min: 0, max: 5, unit: 'degrees' } },
    forward_bend:    { label: '30–40°',  range: { min: 30, max: 40, unit: 'degrees' } },
    side_bend:       { label: 'Minimal', range: { unit: 'qualitative' } },
    pelvic_tilt:     { label: 'Athletic', range: { unit: 'qualitative' } },
    knee_flex:       { label: 'Moderate', range: { unit: 'qualitative' } },
    weight_transfer: { label: '50 / 50', range: { min: 50, max: 50, unit: 'percent_lead' } },
    head_position:   { label: 'Centered', range: { unit: 'qualitative' } },
    lead_arm_position: { label: 'Neutral', range: { unit: 'qualitative' } },
    shaft_pitch:     { label: 'Club dependent', range: { unit: 'qualitative' } },
    wrist_conditions: { label: 'Neutral', range: { unit: 'qualitative' } },
  },

  // ─── P4 — TOP OF SWING ─────────────────────────────────────────────
  p4_top: {
    pelvis_rotation: { label: '35–50°',   range: { min: 35, max: 50, unit: 'degrees' } },
    chest_rotation:  { label: '80–110°',  range: { min: 80, max: 110, unit: 'degrees' } },
    x_factor:        { label: '40–60°',   range: { min: 40, max: 60, unit: 'degrees' } },
    forward_bend:    { label: 'Maintained from address', range: { unit: 'qualitative' } },
    side_bend:       { label: 'Trail-side bend increased', range: { unit: 'qualitative' } },
    weight_transfer: {
      label: '70–90% trail side',
      range: { min: 70, max: 90, unit: 'percent_trail' },
    },
    head_position:   { label: 'Stable — minimal lateral / vertical shift', range: { unit: 'qualitative' } },
    lead_arm_position: { label: 'Across chest plane', range: { unit: 'qualitative' } },
    arm_depth:       { label: 'Moderate to deep', range: { unit: 'qualitative' } },
    wrist_conditions: { label: 'Fully loaded', range: { unit: 'qualitative' } },
  },

  // ─── P5 — LEAD ARM PARALLEL ────────────────────────────────────────
  p5: {
    pelvis_rotation: {
      label: '20–35° open',
      range: { min: 20, max: 35, unit: 'degrees' },
      note: 'Elites open from the ground up before the club arrives here.',
    },
    chest_rotation:  { label: 'Slightly open', range: { unit: 'qualitative' } },
    weight_transfer: { label: 'Lead-side dominant', range: { unit: 'qualitative' } },
    head_position:   { label: 'Stable', range: { unit: 'qualitative' } },
    lead_arm_position: { label: 'In front of chest', range: { unit: 'qualitative' } },
    wrist_conditions: { label: 'Lag retained', range: { unit: 'qualitative' } },
  },

  // ─── P6 — SHAFT PARALLEL ───────────────────────────────────────────
  p6: {
    pelvis_rotation: {
      label: '30–45° open',
      range: { min: 30, max: 45, unit: 'degrees' },
      note: 'One of the strongest sequencing checkpoints.',
    },
    chest_rotation:  { label: '15–30° open', range: { min: 15, max: 30, unit: 'degrees' } },
    weight_transfer: { label: 'Strong lead-side bias', range: { unit: 'qualitative' } },
    head_position:   { label: 'Stable', range: { unit: 'qualitative' } },
    lead_arm_position: { label: 'Organized — in front of chest', range: { unit: 'qualitative' } },
    wrist_conditions: { label: 'Retaining angle', range: { unit: 'qualitative' } },
  },

  // ─── IMPACT ────────────────────────────────────────────────────────
  impact: {
    pelvis_rotation: { label: '35–50° open', range: { min: 35, max: 50, unit: 'degrees' } },
    chest_rotation:  { label: '20–40° open', range: { min: 20, max: 40, unit: 'degrees' } },
    weight_transfer: {
      label: '75–95% lead side',
      range: { min: 75, max: 95, unit: 'percent_lead' },
    },
    head_position:   { label: 'Slightly behind ball', range: { unit: 'qualitative' } },
    forward_bend:    { label: 'Maintained from address', range: { unit: 'qualitative' } },
    side_bend:       { label: 'Lead-side bend present', range: { unit: 'qualitative' } },
    lead_arm_position: { label: 'Extended', range: { unit: 'qualitative' } },
  },

  // ─── FINISH ────────────────────────────────────────────────────────
  finish: {
    pelvis_rotation: { label: 'Fully open', range: { unit: 'qualitative' } },
    chest_rotation:  { label: 'Facing target', range: { unit: 'qualitative' } },
    weight_transfer: {
      label: 'Nearly 100% lead side',
      range: { min: 95, max: 100, unit: 'percent_lead' },
    },
    head_position:   { label: 'Stable; trail foot up on toe only', range: { unit: 'qualitative' } },
  },
};

/**
 * Reverse lookup helper — used by `compareToElite` to fetch a reference
 * by (position, category) with a single call. Returns undefined when
 * no elite reference exists for that combination (intentional gaps).
 */
export function getReference(
  position: keyof BiomechReferenceMap,
  category: string,
) {
  const positionRefs = BIOMECHANICS_REFERENCE_VALUES[position];
  return positionRefs?.[category as keyof typeof positionRefs];
}
