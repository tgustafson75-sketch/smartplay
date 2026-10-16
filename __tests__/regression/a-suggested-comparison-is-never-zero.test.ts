/**
 * 2026-10-16 — Lily's DTL swing was offered "Tour-median driver — 0% match", badged BEST, with
 * "Focus: weight shift — weight shift: 81 % to lead off". A reference that matches on nothing is not a
 * "closest reference in your library"; 0% is not a similarity. (The 81 came from a weight shift a camera
 * behind her cannot measure — refused at the source now, see dtl-numbers-a-camera-can-measure.)
 */
import { searchSimilarSwings } from '../../services/swingDatabase';
import type { PoseEstimate } from '../../services/poseEstimator';

const estimate = (bio: Record<string, unknown>): PoseEstimate => ({
  source: 'video', confidence: 80, frames: [], swingVerdict: null, reason: 'test', age_band: 'adult', mirrored: false,
  joint_confidence: { hip: 0.9, shoulder: 0.9, knee: 0.7, wrist: 0.7, ankle: 0.7, head: 0.7 }, partial_view: false,
  biomechanics: {
    hipTurnDeg: null, shoulderTurnDeg: null, weightShiftPct: null, spineAngleDeltaDeg: null, headDriftPxNorm: null,
    hipSlideRatio: null, frames: [], verdicts: { hipTurn: null, shoulderTurn: null, weightShift: null, posture: null },
    ...bio,
  },
} as unknown as PoseEstimate);

describe('suggested comparisons', () => {
  it('a swing that matches a reference on nothing is not offered a 0% "best" match', async () => {
    // Every compared metric far beyond its spread from every seed archetype.
    const m = await searchSimilarSwings(estimate({ weightShiftPct: -1, spineAngleDeltaDeg: 40, headDriftPxNorm: 0.9 }), 2, { club: 'Driver' });
    expect(m.every((x) => x.similarity > 0)).toBe(true);
  });

  it('a real near-match is still offered', async () => {
    const m = await searchSimilarSwings(estimate({ hipTurnDeg: 45, shoulderTurnDeg: 95, spineAngleDeltaDeg: 4, headDriftPxNorm: 0.02 }), 2, { club: 'Driver' });
    expect(m.length).toBeGreaterThan(0);
    expect(m[0].similarity).toBeGreaterThan(50);
  });
});
