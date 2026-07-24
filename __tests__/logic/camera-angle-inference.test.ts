/**
 * 2026-07-24 (full-app audit, root D) — angle-honesty math. computeBiomechanics only
 * reports turn / weight-shift / sequencing when the camera can honestly measure them
 * (FACE-ON). When a caller doesn't know the angle (Coach lesson, library upload backfill)
 * we INFER it from pose geometry: face-on the shoulders span a wide x-extent relative to
 * torso height; down-the-line they collapse to a narrow stacked line. These tests lock the
 * classifier so it stays CONSERVATIVE — confident DTL / face-on only, ambiguous → null.
 */
import { inferCameraAngle } from '../../services/cameraAngleInference';
import type { PoseFrame } from '../../services/poseAnalysisApi';

// Torso height is fixed at 0.30 (shoulder y=0.30 → hip y=0.60); we vary shoulder WIDTH to
// sweep the shoulderWidthX / torsoHeightY ratio the classifier keys off.
function frame(shoulderWidthX: number): PoseFrame {
  const cx = 0.5;
  const half = shoulderWidthX / 2;
  return {
    timestampMs: 0,
    keypoints: [
      { name: 'left_shoulder', x: cx - half, y: 0.30, score: 0.9 },
      { name: 'right_shoulder', x: cx + half, y: 0.30, score: 0.9 },
      { name: 'left_hip', x: cx - half * 0.9, y: 0.60, score: 0.9 },
      { name: 'right_hip', x: cx + half * 0.9, y: 0.60, score: 0.9 },
    ],
  };
}

describe('inferCameraAngle', () => {
  it('reads a wide, broad subject as face-on (ratio ~0.83 > 0.60)', () => {
    // shoulderWidth 0.25 / torso 0.30 = 0.83
    expect(inferCameraAngle([frame(0.25), frame(0.25)])).toBe('face_on');
  });

  it('reads a narrow, stacked subject as down-the-line (ratio ~0.20 < 0.35)', () => {
    // shoulderWidth 0.06 / torso 0.30 = 0.20 — edge-on
    expect(inferCameraAngle([frame(0.06), frame(0.06)])).toBe('down_the_line');
  });

  it('returns null in the ambiguous mid-band (0.35..0.60) — never guesses', () => {
    // shoulderWidth 0.14 / torso 0.30 = 0.47
    expect(inferCameraAngle([frame(0.14), frame(0.14)])).toBeNull();
  });

  it('uses the WIDEST frame (a face-on swing that foreshortens at the top still reads face-on)', () => {
    // address broad (0.83) + top foreshortened to narrow (0.20) → MAX ratio wins → face_on
    expect(inferCameraAngle([frame(0.25), frame(0.06)])).toBe('face_on');
  });

  it('returns null when fewer than 2 frames have all four torso joints', () => {
    const partial: PoseFrame = {
      timestampMs: 0,
      keypoints: [{ name: 'left_shoulder', x: 0.4, y: 0.3, score: 0.9 }],
    };
    expect(inferCameraAngle([frame(0.25), partial])).toBeNull();
    expect(inferCameraAngle([])).toBeNull();
  });

  it('ignores low-score keypoints (a score-0.1 shoulder is not trusted)', () => {
    const noisy: PoseFrame = {
      timestampMs: 0,
      keypoints: [
        { name: 'left_shoulder', x: 0.25, y: 0.30, score: 0.1 },
        { name: 'right_shoulder', x: 0.75, y: 0.30, score: 0.1 },
        { name: 'left_hip', x: 0.45, y: 0.60, score: 0.9 },
        { name: 'right_hip', x: 0.55, y: 0.60, score: 0.9 },
      ],
    };
    // Only ONE clean frame → sampled < 2 → null (the noisy frame's shoulders are dropped).
    expect(inferCameraAngle([frame(0.25), noisy])).toBeNull();
  });
});
