/**
 * services/swing/poseInterpolate.ts — PURE pose-frame interpolation (2026-08-11).
 *
 * Split out of components/swinglab/SwingBodyOverlay so the pose-WINDOW behavior is directly
 * testable. The component imports react-native-svg, which plain node cannot load, so the logic that
 * decides WHETHER A SKELETON IS DRAWN AT ALL lived somewhere no test could reach — which is how it
 * regressed to drawing an address pose over a player who hadn't walked into frame yet.
 *
 * Same move as services/intents/scoreParse: the decision logic goes where it can be tested, the
 * component keeps the rendering.
 */
import type { PoseFrame, Keypoint } from '../poseAnalysisApi';
import { catmullRomPoint } from './smoothArc';

/**
 * 2026-08-11 (Tim — "the skeleton's back to showing up PRE-SWING again on playback… when you engage
 * it on playback it lags, and it'll start before the swing or the user's even in the frame").
 *
 * ROOT CAUSE: this CLAMPED. Outside the pose window it returned the first frame (address) or the
 * last (finish), so during the seconds of clip BEFORE the swing — walk-up, waggle, an empty tee —
 * the address skeleton was drawn anyway. It sat over grass, or beside a player still walking in,
 * which is exactly the offset skeleton in his screenshot 2997. Nothing was lagging; we were drawing
 * a pose at a time that pose never existed.
 *
 * Pose frames carry ABSOLUTE clip timestamps (window.startMs + span×fraction), and playback is
 * absolute too, so the two are already in the same basis — the clamp was the whole defect.
 *
 * Now: a small tolerance either side (so the skeleton doesn't strobe at the exact boundary), and
 * NOTHING beyond that. No pose at this moment means no skeleton at this moment.
 */
const POSE_EDGE_TOLERANCE_MS = 400;

export function interpolateFrame(frames: PoseFrame[], timeMs: number): PoseFrame | null {
  if (frames.length === 0) return null;
  if (frames.length === 1) return frames[0];
  const sorted = [...frames].sort((a, b) => a.timestampMs - b.timestampMs);
  const first = sorted[0].timestampMs;
  const last = sorted[sorted.length - 1].timestampMs;
  // Outside the swing entirely — draw nothing rather than a pose from another moment.
  if (timeMs < first - POSE_EDGE_TOLERANCE_MS) return null;
  if (timeMs > last + POSE_EDGE_TOLERANCE_MS) return null;
  if (timeMs <= first) return sorted[0];
  if (timeMs >= last) return sorted[sorted.length - 1];
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (timeMs >= a.timestampMs && timeMs <= b.timestampMs) {
      const span = b.timestampMs - a.timestampMs;
      const t = span > 0 ? (timeMs - a.timestampMs) / span : 0;
      // 2026-08-06 (Tim — mechanics "super tight", "the skeleton slides robotically"). Smooth the skeleton
      // between sparse anchors with CATMULL-ROM (through the neighboring frames) instead of a straight
      // chord, so the body — and the grip end of the blue shaft — tracks the real motion between anchors
      // instead of sliding in a straight line. Endpoints clamp (degrade to ~linear).
      const p0 = sorted[i - 1] ?? a;
      const p3 = sorted[i + 2] ?? b;
      const blended: Keypoint[] = a.keypoints.map(ka => {
        const kb = b.keypoints.find(p => p.name === ka.name);
        if (!kb) return ka;
        const k0 = p0.keypoints.find(p => p.name === ka.name) ?? ka;
        const k3 = p3.keypoints.find(p => p.name === ka.name) ?? kb;
        // 2026-08-06 (analysis audit) — CENTRIPETAL eval (was uniform CR, which overshoots the true top of
        // the swing between sparse anchors — flinging the joint above the real position). Same curve family
        // as the drawn trace, so the grip end of the blue shaft stays consistent with the clubhead marker.
        const pt = catmullRomPoint(
          { x: k0.x, y: k0.y, t: 0 }, { x: ka.x, y: ka.y, t: 0 },
          { x: kb.x, y: kb.y, t: 0 }, { x: k3.x, y: k3.y, t: 0 }, t,
        );
        return { name: ka.name, x: pt.x, y: pt.y, score: Math.min(ka.score, kb.score) };
      });
      return { timestampMs: timeMs, keypoints: blended };
    }
  }
  return sorted[sorted.length - 1];
}

