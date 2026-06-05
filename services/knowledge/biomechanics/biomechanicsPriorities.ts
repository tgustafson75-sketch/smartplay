/**
 * 2026-06-04 — Tank's biomechanics coaching priorities.
 *
 * NOT a scoring weight — these ranks control which finding Tank LEADS
 * WITH when multiple deviations are present at once. Higher rank = more
 * important to surface first. The Movement → Cause → Ball Flight →
 * Strike → Outcome chain always applies; priority just sets the order.
 */

import type { PriorityEntry } from './types';

export const BIOMECHANICS_PRIORITIES: readonly PriorityEntry[] = [
  {
    category: 'head_stability',
    rank: 1,
    label: 'Head stability',
    trackingNotes: 'Track lateral, vertical, forward and backward head movement across the swing.',
    coachingConnections: [
      'early extension',
      'reverse pivot',
      'low-point inconsistency',
      'heel strikes',
      'loss of posture',
      'balance problems',
    ],
  },
  {
    category: 'pelvis_distance_from_ball',
    rank: 2,
    label: 'Pelvis distance from ball (early-extension detector)',
    trackingNotes: 'Compare address pelvis depth versus downswing pelvis depth — flag maintained / minor loss / moderate loss / severe loss.',
    coachingConnections: [
      'early extension',
      'thin / heel contact',
      'lost room for the club',
      'over-the-top compensation',
    ],
  },
  {
    category: 'weight_transfer',
    rank: 3,
    label: 'Weight transfer (pressure / mass / center-of-pressure)',
    trackingNotes: 'Elite pattern: 50/50 at address → 70-90% trail at top → rapid shift in transition → 75-95% lead at impact → near 100% lead at finish.',
    coachingConnections: [
      'low-point control',
      'sequencing',
      'power transfer',
      'fat / thin contact patterns',
    ],
  },
  {
    category: 'chest_rotation',
    rank: 4,
    label: 'Chest rotation (thorax turn)',
    trackingNotes: 'Track thorax rotation throughout the swing; under-rotation is the common amateur pattern.',
    coachingConnections: [
      'reduced power',
      'timing issues',
      'hand manipulation to square the face',
      'face-control inconsistency',
    ],
  },
  {
    category: 'lead_arm_position',
    rank: 5,
    label: 'Lead arm organization',
    trackingNotes: 'Track arm depth, elevation, structure, and arm-body relationship. Prioritize lead-arm ORGANIZATION over wrist minutiae.',
    coachingConnections: [
      'disconnected transition',
      'delivery variability',
      'chicken wing',
      'face open at impact',
    ],
  },
] as const;

/** Lookup by category — returns undefined for categories outside the
 *  top-5 priority list. Callers use this to decide which finding to
 *  surface first when multiple deviations are present. */
export function priorityFor(
  category: PriorityEntry['category'],
): PriorityEntry | undefined {
  return BIOMECHANICS_PRIORITIES.find(p => p.category === category);
}
