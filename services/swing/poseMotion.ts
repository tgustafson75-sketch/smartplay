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
 * (2026-08-09 — poseMotionSampler.ts, the staged pose I/O half, was DELETED: zero callers and it
 * passed a video URI to analyzePoseFromUri, which expects an image — dead and broken. This pure,
 * sim-tested core stays as the foundation for the planned on-device locate; the I/O layer will be
 * rewritten against thumbnail extraction when that lands.)
 */

// TYPE-ONLY import (erased at runtime) so this module stays pure — no expo/native deps — and is
// directly unit-testable (exercised by the sim harness synthetic-swing check).
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
  return heightAnchors(pts) ?? speedAnchors(pts);
}

/**
 * 2026-10-16 (Tim, on Lily's 4075 driver clip: "the other points of the swing, not correct. It's not
 * going to them correctly") — THE SWING'S SHAPE, NOT ITS FASTEST GAP.
 *
 * The speed read below takes impact as the fastest gap between two samples. On real MediaPipe wrists,
 * ~150ms apart, the fastest gap is as often the follow-through, a jittery low-visibility wrist, or the
 * club coming down AFTER the finish — and "top" is then the highest point before THAT, which is the
 * finish. Run on the real wrist track of 4075.mp4 (address ~4.85s, top ~5.65, impact ~6.04, finish
 * ~6.55) with the windows the app actually samples, the speed read put impact at 6.38s and 6.95s
 * (her standing after the swing) and top at 6.33s (the finish).
 *
 * The height of the hands is far more robust than their speed, and it reads the same from either
 * camera: they start low (address), rise to the top, come back down to about where they started
 * (impact), and rise again (finish). So:
 *   address  the hands' height in the first samples (the window opens before the takeaway);
 *   top      the highest point of the FIRST rise (hands at least 60% of the swing's height);
 *   impact   the lowest point of the descent that follows, before the hands climb again;
 *   finish   the top of the next climb — the first apex after impact, not a later wave of the club;
 *   start    the last sample before the top still at address height.
 * Returns null where that shape is not there (a window that opens mid-swing, a player standing still),
 * and the speed read answers as before.
 */
function heightAnchors(pts: MotionSample[]): SwingAnchors | null {
  const baseY = median(pts.slice(0, 3).map((p) => p.y));
  const h = pts.map((p) => baseY - p.y);   // image y grows downward: positive = hands higher than address
  const amp = Math.max(...h);
  if (!(amp >= 0.05)) return null;
  // The first rise: first sample past 60% of the swing's height.
  let rise = -1;
  for (let i = 1; i < h.length; i++) if (h[i] >= 0.6 * amp) { rise = i; break; }
  if (rise < 1) return null;
  // Top and impact together: the highest point of that rise, then the lowest point after it, found
  // once the hands have come down from the top (by 35% of the swing's height) AND climbed back up from
  // the trough (by 25%). Relative drops, not fixed heights: ~150ms apart, the sample nearest impact can
  // sit well above address height (the hands pass the ball in a few milliseconds).
  let top = rise;
  let impact = rise;
  let climb = -1;
  for (let i = rise; i < h.length; i++) {
    const descended = h[top] - h[impact] >= 0.35 * amp;
    if (!descended && h[i] > h[top]) { top = i; impact = i; continue; }
    if (h[i] < h[impact]) { impact = i; continue; }
    if (descended && h[i] - h[impact] >= 0.25 * amp) { climb = i; break; }
  }
  if (climb < 0) return null;
  // Finish: the apex of that climb — stop once the hands have clearly come down from it.
  let end = climb;
  for (let i = climb; i < h.length; i++) {
    if (h[i] > h[end]) end = i;
    else if (h[end] - h[i] > 0.15 * amp) break;
  }
  // Start: the last sample before the top that is still at address height.
  let start = 0;
  for (let i = top - 1; i >= 0; i--) {
    if (h[i] <= 0.1 * amp) { start = i; break; }
  }
  if (!(start < top && top < impact && impact < end)) return null;
  return { startMs: pts[start].tMs, topMs: pts[top].tMs, impactMs: pts[impact].tMs, endMs: pts[end].tMs };
}

/** The original read: impact at the fastest gap. The fallback where the height shape is not there. */
function speedAnchors(pts: MotionSample[]): SwingAnchors | null {
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
  // 2026-10-03 (review) — begin BEFORE the top: with dense samples around the apex the hands are nearly
  // still at the transition, so testing speed[top] itself returned start = top and cut the backswing out
  // of the window (2-5% of short clips in a 200-trial sim).
  for (let i = top - 1; i >= 0; i--) {
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

/** The swing's anchors read off a body read's frames (their wrists), or null. */
export function anchorsFromPoseFrames(frames: readonly PoseFrame[] | null | undefined): SwingAnchors | null {
  if (!frames?.length) return null;
  const samples: MotionSample[] = [];
  for (const fr of frames) {
    const c = wristCentroid(fr);
    if (c && Number.isFinite(fr.timestampMs)) samples.push({ tMs: fr.timestampMs, x: c.x, y: c.y });
  }
  return deriveSwingAnchors(samples);
}

export type SwingStageKey = 'P1_address' | 'P4_top' | 'P6_impact' | 'P10_finish';
export const SWING_STAGES: readonly { key: SwingStageKey; label: string }[] = [
  { key: 'P1_address', label: 'Address' }, { key: 'P4_top', label: 'Top' },
  { key: 'P6_impact', label: 'Impact' }, { key: 'P10_finish', label: 'Finish' },
];

/**
 * 2026-10-16 (Tim, Lily's 4075 clip: the Address / Top / Impact / Finish buttons "not going to them
 * correctly") — WHERE EACH STAGE BUTTON SEEKS, for every review screen (the swing library and SmartMotion
 * both call this; neither decides on its own).
 *
 * The positions measured from the hands' motion on THIS body read win. A frame label does not: when the
 * read was anchored on an impact time, P1/P4/P10 are placed at FIXED offsets from it (impact -2000 /
 * -320 / +700ms, poseAnalysisApi) and carry `positionSource: 'strike'` — so the old "a strike label is
 * a measurement" rule seeked Address and Finish to whatever sat two seconds before and 0.7s after a
 * located impact (itself read from a dozen coarse samples by the locate). The one exception is a HEARD
 * strike (`heardStrike`): the microphone timed impact to the frame, so the Impact button uses it.
 * A label only answers where the motion gave no answer.
 */
export function swingStageTimesMs(
  frames: readonly PoseFrame[] | null | undefined,
  opts: { heardStrike?: boolean; anchors?: SwingAnchors | null } = {},
): { key: SwingStageKey; label: string; ms: number }[] {
  if (!frames?.length) return [];
  const a = opts.anchors !== undefined ? opts.anchors : anchorsFromPoseFrames(frames);
  const measured: Record<SwingStageKey, number | undefined> = {
    P1_address: a?.startMs, P4_top: a?.topMs, P6_impact: a?.impactMs, P10_finish: a?.endMs,
  };
  const out: { key: SwingStageKey; label: string; ms: number }[] = [];
  for (const s of SWING_STAGES) {
    const f = frames.find((p) => p.position === s.key && Number.isFinite(p.timestampMs));
    const m = measured[s.key];
    let ms: number | undefined;
    if (s.key === 'P6_impact' && opts.heardStrike && f && f.positionSource === 'strike') ms = f.timestampMs;
    else if (typeof m === 'number' && Number.isFinite(m)) ms = m;
    else if (f) ms = f.timestampMs;
    if (ms != null) out.push({ key: s.key, label: s.label, ms });
  }
  return out;
}
