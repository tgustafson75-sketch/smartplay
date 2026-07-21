/**
 * 2026-07-21 — pose I/O for the motion anchoring ([[pose-first-analysis-rearchitecture]]).
 * Kept separate from poseMotion.ts (which is PURE + unit-tested) because this imports the pose
 * pipeline (expo/native), so it can't run under the Node sim.
 */

import { analyzePoseFromUri, type PoseFrame } from '../poseAnalysisApi';
import type { MotionSample } from './poseMotion';
import { wristCentroid } from './poseMotion';

/**
 * Sample pose densely across [fromMs, toMs] and return the hand-motion trace + the frames. `count`
 * frames — 16-20 is dense enough to resolve the top + impact without being costly (on-device
 * MediaPipe is cheap; the server /api/pose-analysis fallback is used only when the native module is
 * unavailable). Robust to a few missing samples.
 */
export async function sampleSwingMotion(
  clipUri: string,
  fromMs: number,
  toMs: number,
  count = 18,
): Promise<{ samples: MotionSample[]; frames: { tMs: number; frame: PoseFrame }[] }> {
  const lo = Math.max(0, Math.min(fromMs, toMs));
  const hi = Math.max(fromMs, toMs);
  const n = Math.max(6, count);
  const times: number[] = [];
  for (let i = 0; i < n; i++) times.push(Math.round(lo + ((hi - lo) * i) / (n - 1)));

  const samples: MotionSample[] = [];
  const frames: { tMs: number; frame: PoseFrame }[] = [];
  for (const t of times) {
    try {
      const frame = await analyzePoseFromUri(clipUri, t);
      if (!frame) continue;
      frames.push({ tMs: t, frame });
      const w = wristCentroid(frame);
      if (w) samples.push({ tMs: t, x: w.x, y: w.y });
    } catch {
      // a few gaps are fine — motion anchoring is robust to missing samples
    }
  }
  return { samples, frames };
}
