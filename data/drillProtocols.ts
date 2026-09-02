/**
 * 2026-08-13 (audit) — canonical rep protocols for drills that are described in more than one place.
 *
 * The pump drill was independently authored in FIVE files, with five different answers:
 *
 *   data/drillCatalog.ts                    pump 3x, then swing
 *   components/PracticeSessionOverlay.tsx       pump 3x, 4th finishes through
 *   services/coachKnowledge.ts              pump 2-3x, hit on the third
 *   services/drillRecommendation.ts         twenty pumps, then a ball
 *   services/knowledgeBase/modules/drills.ts   15-20 pumps, then hit
 *
 * Tim's report was that he never knew exactly how to perform it and never finished the swing. That
 * is not a coaching-copy problem, it is the app telling him five different things and none of them
 * being wrong enough to notice — the same many-independent-authors defect as the caddie identity and
 * the geometry writers, landing this time on the instruction that is supposed to fix his swing.
 *
 * So: ONE owner, imported rather than restated. Not a "keep them in sync" comment — every sync
 * comment in this repo's history eventually described two things that had already diverged.
 *
 * Only drills whose description is DUPLICATED belong here. A drill described in exactly one place is
 * already single-sourced and adding it here would be ceremony.
 */

export interface DrillProtocol {
  /** Rehearsal reps before the real swing. */
  readonly pumps: number;
  /** One spoken sentence — the caddie/brain register. */
  readonly how: string;
  /** Discrete on-screen steps — the cage-overlay register. */
  readonly steps: readonly string[];
}

/**
 * Pump drill. Three rehearsals, the fourth is a real swing to a FULL FINISH.
 *
 * The finish is load-bearing, not a flourish: a pump drill that stops at the pumps teaches the
 * transition and leaves the player without the motion they actually have to make over the ball,
 * which is exactly the gap Tim described.
 */
export const PUMP_DRILL: DrillProtocol = {
  pumps: 3,
  how: 'Swing to the top, then pump down to hip height three times — feel the lower body start the move and the club drop behind you. On the fourth, swing through to a full finish.',
  steps: [
    'Take the club to the top.',
    'Pump down to hip height 3x — lower body starts, club drops behind you.',
    'On the 4th, swing through to a full finish.',
  ],
} as const;
