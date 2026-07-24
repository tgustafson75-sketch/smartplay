/**
 * 2026-07-23 (Tim — "meta glasses can voice-request recording video, ingest it smartly" + Coach Caddie
 * should be totally caddie-led, near-zero tap). Captures a SWING from the Ray-Ban Meta glasses frame
 * stream and runs it through the SAME cloud pose pipeline the phone-video path uses — so the caddie can
 * watch a swing and coach it WITHOUT the phone camera (which, in video mode, seizes the audio session
 * and cuts off the caddie's voice — see [[realtime-virtual-caddie-lesson]]). The glasses record over
 * Bluetooth on their own camera, leaving the phone audio free for continuous TTS: the unlock for a
 * hands-free lesson loop.
 *
 * Mechanism (uses only shipped infra — no new native module):
 *   1. Ensure the glasses are streaming; tap the raw frame fan-out (metaWearablesBridge.onGlassesFrame).
 *   2. Collect frames over a swing window (~6s).
 *   3. Subsample ~5 frames evenly across the window and pose-analyze each via analyzePoseFromUri
 *      (cloud pose — no MediaPipe dependency), tagging them with swing positions by temporal order —
 *      the SAME even-sample-and-tag fallback the video-upload path uses when there's no acoustic anchor.
 *   4. computeBiomechanicsFromFrames → SwingBiomechanics (honesty gates null any metric the frames
 *      can't support, so an unreadable window degrades honestly rather than fabricating numbers).
 *
 * Angle: default 'face_on' — the coaching use is the glasses pointed AT a golfer (the wearer filming a
 * player, or a mounted view). First-person POV of the wearer's own ball can't see their body; the
 * angle-honesty gates in computeBiomechanics handle whatever the frames actually show.
 */
import { onGlassesFrame, isMetaWearablesAvailable, getGlassesStatusSync, startMetaWearablesStreaming } from './metaWearablesBridge';
import { analyzePoseFromUri, computeBiomechanicsFromFrames, type SwingBiomechanics, type PoseFrame } from './poseAnalysisApi';

// The positions computeBiomechanics reads (address/top/impact drive the turn + weight metrics).
const SWING_POSITIONS: PoseFrame['position'][] = ['P1_address', 'P2_takeaway', 'P4_top', 'P6_impact', 'P10_finish'];

/** Pick `n` items spread evenly across `arr` (first + last included). */
export function pickSpanning<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr.slice();
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(arr[Math.round((i / (n - 1)) * (arr.length - 1))]);
  return out;
}

export interface GlassesSwingResult {
  biomech: SwingBiomechanics | null;
  framesSeen: number;
  reason?: string;
}

/**
 * Capture and analyze one swing from the glasses stream. Resolves with the biomechanics (or null +
 * a reason when the glasses aren't available / not enough frames / pose failed). Never throws.
 */
export async function captureGlassesSwing(opts?: {
  windowMs?: number;
  angle?: 'down_the_line' | 'face_on' | 'glasses_pov' | null;
  handedness?: 'right' | 'left' | null;
}): Promise<GlassesSwingResult> {
  const windowMs = opts?.windowMs ?? 6000;
  if (!isMetaWearablesAvailable()) return { biomech: null, framesSeen: 0, reason: 'glasses_unavailable' };

  // Make sure frames are flowing before we start collecting.
  try {
    if (!getGlassesStatusSync().streaming) await startMetaWearablesStreaming('medium', 24);
  } catch {
    return { biomech: null, framesSeen: 0, reason: 'stream_start_failed' };
  }

  const collected: { uri: string; t: number }[] = [];
  const t0 = Date.now();
  const unsub = onGlassesFrame((f) => { collected.push({ uri: f.uri, t: f.captured_at || Date.now() }); });
  try {
    await new Promise<void>((resolve) => setTimeout(resolve, windowMs));
  } finally {
    unsub();
  }

  if (collected.length < 3) return { biomech: null, framesSeen: collected.length, reason: 'too_few_frames' };

  const picks = pickSpanning(collected, SWING_POSITIONS.length);
  const frames: PoseFrame[] = [];
  for (let i = 0; i < picks.length; i++) {
    // Pose-detect the keyframe; tag with the swing position for this slot (temporal order).
    const pf = await analyzePoseFromUri(picks[i].uri, Math.max(0, picks[i].t - t0)).catch(() => null);
    if (pf) frames.push({ ...pf, position: SWING_POSITIONS[i] });
  }
  if (frames.length < 3) return { biomech: null, framesSeen: collected.length, reason: 'pose_unreadable' };

  const biomech = computeBiomechanicsFromFrames(frames, opts?.angle ?? 'face_on', opts?.handedness ?? 'right');
  return { biomech, framesSeen: collected.length };
}
