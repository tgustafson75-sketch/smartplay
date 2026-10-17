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
 *   address  the hands' lowest height in the first samples (the window opens before the takeaway);
 *   top      the highest point of the FIRST rise (hands at least 60% of the swing's height);
 *   impact   the lowest point of the descent that follows, before the hands climb again;
 *   finish   the top of the next climb — the first apex after impact, not a later wave of the club;
 *   start    the last sample before the top still at address height.
 * Returns null where that shape is not there (a window that opens mid-swing, a player standing still),
 * and the speed read answers as before.
 */
/** A downswing is fast: top to impact inside this. A practice swing, a waggle or a stray raised-hands
 *  sample before the real swing is not (Tim's 3870: one raised sample at 3.0s made "impact" 5.5s). */
const MAX_TOP_TO_IMPACT_MS = 700;
/** A real impact has a follow-through after it. */
const MIN_IMPACT_TO_FINISH_MS = 250;
/** The finish is found inside this much time after impact — the club coming down later is not it. */
const FINISH_SEARCH_MS = 900;
/** A spike needs both neighbours this close to be called noise (coarse locate samples are never judged). */
const SPIKE_GAP_MS = 250;
/** After impact the hands climb at once; a "climb" that only starts this long after the trough is not a follow-through. */
const FOLLOW_THROUGH_STARTS_MS = 500;

function heightAnchors(pts: MotionSample[]): SwingAnchors | null {
  // Address height: the LOWEST hands among the first samples (image y grows downward). A median let a
  // window that opens on the takeaway lift the baseline, and "address" then landed mid-takeaway.
  const baseY = Math.max(...pts.slice(0, 3).map((p) => p.y));
  const raw = pts.map((p) => baseY - p.y);   // image y grows downward: positive = hands higher than address
  /**
   * 2026-10-16 (re-review) — ONE JITTERY SAMPLE IS NOT A TOP. A single raised-hands sample standing far
   * above BOTH close neighbours (< SPIKE_GAP_MS each side) is tracker noise — a body does not go up and
   * come back down in two frames — so it reads as its higher neighbour. Without this, one jitter frame
   * during Lily's address (47 of 54 positions) or at 3870's 5.8s became "the top", and its one-gap fall
   * the fastest descent of the clip. Only positive spikes: the trough at impact IS brief.
   */
  const amp0 = Math.max(...raw);
  const h = raw.map((v, i) => {
    if (i === 0 || i === raw.length - 1) return v;
    if (pts[i].tMs - pts[i - 1].tMs >= SPIKE_GAP_MS || pts[i + 1].tMs - pts[i].tMs >= SPIKE_GAP_MS) return v;
    const nb = Math.max(raw[i - 1], raw[i + 1]);
    return v - nb > 0.35 * amp0 ? nb : v;
  });
  const amp = Math.max(...h);
  if (!(amp >= 0.05)) return null;
  /**
   * 2026-10-16 (adversarial review, on Tim's real 3870 wrists) — EVERY rise is a candidate, and the swing
   * is the one that behaves like a swing. Taking the FIRST rise past 60% let one raised-hands sample at
   * 3.0s (a waggle, aiming, a practice swing) become "the top" and the lowest point in the 2.5s after it
   * "impact" — and the locate, the stored strike label and the club-arc anchor all followed it. A
   * candidate counts only with a downswing-fast top → impact and a follow-through after impact; among
   * those, the fastest descent wins (a practice swing is slower than the real one).
   */
  let best: { top: number; impact: number; end: number; rate: number } | null = null;
  let from = 1;
  while (from < h.length) {
    let rise = -1;
    for (let i = from; i < h.length; i++) if (h[i] >= 0.6 * amp) { rise = i; break; }
    if (rise < 0) break;
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
    if (climb < 0) break;
    // Finish: the highest the hands get within FINISH_SEARCH_MS of impact, HELD — the last sample in that
    // span still within 10% of the swing's height of the peak (a single jittery wrist neither ends nor
    // starts it), not the first dip after the climb (which put 3870's finish 100ms after impact and
    // Lily's 220ms early).
    const inFinish = (i: number) => i < h.length && pts[i].tMs - pts[impact].tMs <= FINISH_SEARCH_MS;
    let peak = climb;
    for (let i = climb; inFinish(i); i++) if (h[i] > h[peak]) peak = i;
    let end = peak;
    for (let i = peak + 1; inFinish(i); i++) if (h[peak] - h[i] <= 0.1 * amp) end = i;
    const downMs = pts[impact].tMs - pts[top].tMs;
    // 2026-10-16 (re-review) — the SHORTEST downswing these samples allow (the sample after the top to the
    // sample before impact): the real one may sit in an unsampled gap, and a 709ms OBSERVED gap rejected
    // Lily's real swing that the old read placed within 18ms.
    const minDownMs = Math.max(0, (impact - 1 > top ? pts[impact - 1].tMs : pts[impact].tMs) - (top + 1 < impact ? pts[top + 1].tMs : pts[top].tMs));
    // The follow-through starts AT impact: the hands climb straight back up (sample before the climb to
    // impact inside FOLLOW_THROUGH_STARTS_MS). A stray raised sample followed by a long rest at address and
    // then the real backswing is not a top, an impact and a finish.
    const climbsAtOnce = pts[climb - 1].tMs - pts[impact].tMs <= FOLLOW_THROUGH_STARTS_MS;
    // A window that ends within MIN_IMPACT_TO_FINISH_MS of impact cannot show a follow-through; it is not
    // held against the swing.
    const windowEndsSoon = pts[pts.length - 1].tMs - pts[impact].tMs < MIN_IMPACT_TO_FINISH_MS;
    if (minDownMs <= MAX_TOP_TO_IMPACT_MS && climbsAtOnce
      && (windowEndsSoon || pts[end].tMs - pts[impact].tMs >= MIN_IMPACT_TO_FINISH_MS)) {
      const rate = (h[top] - h[impact]) / Math.max(1, downMs);
      if (!best || rate > best.rate) best = { top, impact, end, rate };
    }
    // Next candidate: the next rise after this one's top.
    from = top + 1;
    while (from < h.length && h[from] >= 0.6 * amp) from++;
  }
  if (!best) return null;
  const { top, impact, end } = best;
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

/**
 * 2026-10-17 (Tim's range session, a 60s driver capture: the on-device locate answered top 17.4s, impact
 * 42.4s — a 36-second "swing" — and the read, the body read and the verdict all followed it). The height
 * read refuses that shape; the speed read below it, its fallback, had no sense of size at all.
 *
 * WHAT A LOCATED SWING CAN BE. Address to finish fits well inside 6s (the network locator's own window
 * is 5.5s), and top to impact is a downswing — well under 1.5s even seen through coarse samples. A
 * located window bigger than that is not a swing that was found; it is a locate that failed, and the
 * callers treat it exactly like one.
 */
export const MAX_LOCATED_SWING_MS = 6_000;
export const MAX_LOCATED_TOP_TO_IMPACT_MS = 1_500;
/**
 * A STORED swing window (a capture's segment, a located window with its padding) longer than this is not
 * one swing: the same 8s below which a whole clip IS the swing (analysisOrchestrator).
 */
export const MAX_SWING_WINDOW_SEC = 8;

/** Is this located window the size of a swing? `topMs` is checked when the locator measured one. */
export function isSwingSized(w: { startMs: number; endMs: number; topMs?: number | null; impactMs?: number | null }): boolean {
  if (!(Number.isFinite(w.startMs) && Number.isFinite(w.endMs) && w.endMs > w.startMs)) return false;
  if (w.endMs - w.startMs > MAX_LOCATED_SWING_MS) return false;
  if (typeof w.topMs === 'number' && typeof w.impactMs === 'number' && w.impactMs - w.topMs > MAX_LOCATED_TOP_TO_IMPACT_MS) return false;
  return true;
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

/** A heard strike and the motion read disagreeing by more than this: the motion read is wrong. */
export const HEARD_DISAGREE_MS = 150;

/**
 * 2026-10-16 (review) — the motion anchors, unless a HEARD strike says they are wrong. When the P6 label
 * sits on a heard strike (frame-exact) and the hands' read puts impact more than HEARD_DISAGREE_MS away,
 * the hands' read is the wrong one (sparse or jittery wrists): null, and every phase falls back to its
 * label. The stage buttons (swingStageTimesMs) and the body read (computeBiomechanics) both apply this,
 * so the Impact button and the impact numbers name one instant.
 */
export function trustHeardStrike(
  frames: readonly PoseFrame[], anchors: SwingAnchors | null, heardStrike: boolean,
): SwingAnchors | null {
  if (!anchors || !heardStrike) return anchors;
  const heard = frames.find((p) => p.position === 'P6_impact' && p.positionSource === 'strike');
  return heard && Math.abs(heard.timestampMs - anchors.impactMs) > HEARD_DISAGREE_MS ? null : anchors;
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
  const a = trustHeardStrike(frames, opts.anchors !== undefined ? opts.anchors : anchorsFromPoseFrames(frames), !!opts.heardStrike);
  const measured: Record<SwingStageKey, number | undefined> = {
    P1_address: a?.startMs, P4_top: a?.topMs, P6_impact: a?.impactMs, P10_finish: a?.endMs,
  };
  const out: { key: SwingStageKey; label: string; ms: number }[] = [];
  for (const s of SWING_STAGES) {
    const f = frames.find((p) => p.position === s.key && Number.isFinite(p.timestampMs));
    const m = measured[s.key];
    let ms: number | undefined;
    const heardImpact = s.key === 'P6_impact' && !!opts.heardStrike && !!f && f.positionSource === 'strike';
    if (heardImpact) ms = f!.timestampMs;
    else if (typeof m === 'number' && Number.isFinite(m)) ms = m;
    else if (f) ms = f.timestampMs;
    if (ms == null) continue;
    // 2026-10-16 (review) — the stages are an ORDER. Taken from different sources (a heard Impact, the
    // motion's others, a fallback label) they could cross; a stage that would sit at or before the one
    // before it is left out rather than shown as "Top after Impact". A HEARD Impact is the surest of them
    // (re-review): the earlier stages it contradicts are the ones dropped, never it.
    if (heardImpact) while (out.length > 0 && out[out.length - 1].ms >= ms) out.pop();
    if (out.length === 0 || ms > out[out.length - 1].ms) out.push({ key: s.key, label: s.label, ms });
  }
  return out;
}
