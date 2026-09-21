/**
 * WHERE THE PLAYER IS IN THE FRAME — the one owner, so every club-path caller can crop.
 *
 * 2026-09-20 (Tim's Sentry, SM-F926U, and his eight-month complaint that we "cannot seem to reliably
 * track a clubhead and draw a line where it travels"):
 *
 *     clubpath_arc_too_sparse { screen: "swing-detail", detected: 2, framesSampled: 14,
 *                               framesPlanned: 14, rejected: "too_few", points: 0 }
 *
 * The sampler did its whole job — fourteen of fourteen planned frames. The model found a clubhead in
 * TWO. That is not a gate being strict; that is a ~6px clubhead.
 *
 * The 2026-08-10 ROI crop is the fix for exactly that: crop to the player's pose bounds and spend
 * the 640px budget there, taking the head from ~6px to ~40px. It worked. It was also passed at ONE
 * of the four detectClubPath call sites — the live review pass in smartmotion. The other three ran
 * full-frame:
 *
 *   - smartmotion's PERSIST pass, whose own comment says it exists "so the swing-detail screen draws
 *     the stored points" — i.e. the arc the player keeps was the one computed without the fix;
 *   - the swing-detail screen's own live fallback;
 *   - the swing-detail re-analyse path.
 *
 * services/swing/analysisPipeline's header already named the cause on 2026-09-06 —
 * "`bodyBoundsFromPose` lived in a SCREEN, so the pose pipeline could not reach the crop engine and
 * ran full-frame forever. Nobody owned 'who gets the roi'." It was written down and left in the
 * screen. So it lives here now, and a caller that cannot import a screen has no excuse.
 * [[two-owners-is-the-root-cause]] [[no-half-fixes-enforce-every-surface]]
 */

import type { PoseFrame } from '../poseAnalysisApi';

export interface BodyBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Union of the confident pose keypoints across ALL frames, so the box covers address through
 * finish. Null when pose is unavailable or too weak to trust, which simply leaves the old
 * full-frame behaviour rather than cropping to a guess.
 */
export function bodyBoundsFromPose(frames: PoseFrame[] | null | undefined): BodyBounds | null {
  if (!frames?.length) return null;
  let minX = 1, minY = 1, maxX = 0, maxY = 0, seen = 0;
  for (const f of frames) {
    for (const k of f.keypoints ?? []) {
      // Only confident joints — a flickering low-score keypoint on the horizon would balloon the
      // box, and a ballooned box is the same as no crop at all.
      if ((k.score ?? 0) < 0.4) continue;
      if (!Number.isFinite(k.x) || !Number.isFinite(k.y)) continue;
      if (k.x < 0 || k.x > 1 || k.y < 0 || k.y > 1) continue;
      if (k.x < minX) minX = k.x;
      if (k.x > maxX) maxX = k.x;
      if (k.y < minY) minY = k.y;
      if (k.y > maxY) maxY = k.y;
      seen++;
    }
  }
  if (seen < 8) return null;
  if (!(maxX > minX) || !(maxY > minY)) return null;
  return { minX, minY, maxX, maxY };
}
