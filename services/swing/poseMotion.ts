/**
 * 2026-07-21 — POSE MOTION anchoring ([[pose-first-analysis-rearchitecture]] Phase 2, foundation).
 *
 * The kinematics read is only as good as its anchors. Today "impact" leans on the acoustic strike /
 * segmenter and "top of backswing" on a coarse min-wrist-y; if either drifts, every derived number
 * (weight shift, spine-delta, tempo) drifts with it. This module derives the swing's structure from
 * the MOTION itself — the hand-velocity signal across the clip:
 *   • IMPACT  ≈ the hand-speed PEAK (the downswing is the fastest part of the swing).
 *   • TOP     ≈ hands highest (min y, image y grows downward) BEFORE impact — the transition, where
 *               speed valleys as the hands momentarily stop.
 *   • START   ≈ the last low-motion sample before the takeaway rise (address).
 *   • END     ≈ where speed settles after impact (follow-through).
 * Self-consistent, needs no audio/segmentation, and ALWAYS returns a best-estimate structure for a
 * recorded swing (never "no swing"). deriveSwingAnchors is PURE (unit-tested on synthetic motion);
 * sampleSwingMotion does the pose I/O.
 */

// TYPE-ONLY import (erased at runtime) so this module stays pure — no expo/native deps — and is
// directly unit-testable. The pose I/O lives in poseMotionSampler.ts.
import type { PoseFrame } from '../poseAnalysisApi';

export interface MotionSample { tMs: number; x: number; y: number; }
export interface SwingAnchors { startMs: number; topMs: number; impactMs: number; endMs: number; }

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Average lead+trail wrist position (normalized) from a pose frame, or null if neither is present. */
export function wristCentroid(frame: PoseFrame): { x: number; y: number } | null {
  const byName = (n: string) => frame.keypoints?.find((k) => k.name === n) ?? null;
  const lw = byName('left_wrist');
  const rw = byName('right_wrist');
  const xs = [lw?.x, rw?.x].filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const ys = [lw?.y, rw?.y].filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (xs.length === 0 || ys.length === 0) return null;
  return { x: xs.reduce((a, b) => a + b, 0) / xs.length, y: ys.reduce((a, b) => a + b, 0) / ys.length };
}

/**
 * PURE: derive the swing's start/top/impact/end from the hand-motion samples. Returns null only when
 * there aren't enough samples or no interior top exists (degenerate signal); callers treat null as
 * "fall back to the coarse anchors", never as "no swing".
 */
export function deriveSwingAnchors(samples: MotionSample[]): SwingAnchors | null {
  const pts = samples
    .filter((s) => Number.isFinite(s.tMs) && Number.isFinite(s.x) && Number.isFinite(s.y))
    .sort((a, b) => a.tMs - b.tMs);
  if (pts.length < 5) return null;

  // Speed (normalized units / ms) between consecutive samples.
  const speed: number[] = [0];
  for (let i = 1; i < pts.length; i++) {
    const dt = Math.max(1, pts[i].tMs - pts[i - 1].tMs);
    speed.push(Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y) / dt);
  }

  // IMPACT ≈ global speed peak (downswing is the fastest part of the swing).
  let pk = 1;
  for (let i = 1; i < speed.length; i++) if (speed[i] > speed[pk]) pk = i;

  // TOP ≈ hands highest (min y) at or before the peak — the backswing apex / transition.
  let top = 0;
  for (let i = 0; i <= pk; i++) if (pts[i].y < pts[top].y) top = i;
  if (!(top < pk) || top === 0) {
    // No clean interior top before the peak — degenerate; let the caller keep its coarse anchors.
    return null;
  }

  // START (address) ≈ last near-baseline-motion sample before the takeaway rise.
  const baseline = median(speed.slice(0, Math.min(4, speed.length)));
  let start = 0;
  for (let i = top; i >= 0; i--) {
    if (speed[i] <= baseline * 1.5) { start = i; break; }
  }

  // END ≈ first sample after impact where speed settles below 25% of peak (follow-through), else last.
  let end = pts.length - 1;
  for (let i = pk + 1; i < speed.length; i++) {
    if (speed[i] < speed[pk] * 0.25) { end = i; break; }
  }
  if (end <= pk) end = Math.min(pts.length - 1, pk + 1);

  return { startMs: pts[start].tMs, topMs: pts[top].tMs, impactMs: pts[pk].tMs, endMs: pts[end].tMs };
}
