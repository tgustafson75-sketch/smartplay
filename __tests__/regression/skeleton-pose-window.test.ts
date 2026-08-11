/**
 * 2026-08-11 (Tim) — "The skeleton's back to showing up PRE-SWING again on playback. Remember, we
 * don't want it to play at first because that causes a crash. But then when you do engage it on
 * playback, it lags, and it'll start before the swing or the user's even in the frame."
 *
 * ROOT CAUSE: interpolateFrame CLAMPED. Outside the pose window it returned the first frame
 * (address) or the last (finish), so during the seconds of clip BEFORE the swing — walk-up, waggle,
 * an empty tee — the address skeleton was drawn anyway, sitting over grass or beside a player still
 * walking in. That is the offset skeleton in his screenshot 2997. Nothing was actually lagging; we
 * were drawing a pose at a time that pose never existed.
 *
 * Pose timestamps are ABSOLUTE clip time and playback is absolute, so they already share a basis —
 * the clamp was the entire defect.
 */
import { interpolateFrame } from '../../services/swing/poseInterpolate';
import type { PoseFrame } from '../../services/poseAnalysisApi';

const kp = (x: number) => [{ name: 'left_shoulder', x, y: 0.5, score: 0.9 }];
/** A swing that happens 3s-4s into a 10s clip — the normal on-course case. */
const frames: PoseFrame[] = [
  { timestampMs: 3000, keypoints: kp(0.4) } as PoseFrame,
  { timestampMs: 3500, keypoints: kp(0.5) } as PoseFrame,
  { timestampMs: 4000, keypoints: kp(0.6) } as PoseFrame,
];

describe('the skeleton only exists while the swing does', () => {
  it('draws NOTHING at the very start of the clip (his walk-up)', () => {
    expect(interpolateFrame(frames, 0)).toBeNull();
  });

  it('draws NOTHING a second before the swing', () => {
    expect(interpolateFrame(frames, 2000)).toBeNull();
  });

  it('draws NOTHING well after the finish', () => {
    expect(interpolateFrame(frames, 8000)).toBeNull();
  });

  it('DOES draw through the swing itself', () => {
    expect(interpolateFrame(frames, 3000)).not.toBeNull();
    expect(interpolateFrame(frames, 3500)).not.toBeNull();
    expect(interpolateFrame(frames, 4000)).not.toBeNull();
  });

  it('interpolates between anchors rather than snapping', () => {
    const mid = interpolateFrame(frames, 3250);
    expect(mid).not.toBeNull();
    const x = mid!.keypoints[0].x;
    expect(x).toBeGreaterThan(0.4);
    expect(x).toBeLessThan(0.5);
  });

  it('tolerates a small edge margin so it cannot strobe at the boundary', () => {
    expect(interpolateFrame(frames, 2800)).not.toBeNull(); // 200ms before, within tolerance
    expect(interpolateFrame(frames, 4200)).not.toBeNull(); // 200ms after
  });

  it('a single-frame pose still renders (nothing to bracket)', () => {
    expect(interpolateFrame([frames[0]], 999999)).not.toBeNull();
  });

  it('no frames → nothing', () => {
    expect(interpolateFrame([], 3000)).toBeNull();
  });
});
