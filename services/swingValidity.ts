// Bundle hash bump: 2026-05-20 EAS asset processor was stuck on the
// prior hash; trivial change forces a new bundle id.
/**
 * Phase 418 — Unified swing validation gate (client side).
 *
 * Single source of truth for "is there a valid analyzable swing in this
 * footage." SmartMotion's pose overlay, metrics strip, and Insight card
 * all gate fabrication on this one call so they can't contradict each
 * other (the prior bug: skeleton + 82 mph "club speed" on floor footage
 * while the caddie correctly said "no player visible").
 *
 * Server emits valid_swing + validity_reason directly (api/swing-analysis
 * Phase 418). For backward compatibility — older API responses, cached
 * results — we fall back to an observation-text heuristic that catches
 * the no-player phrasing the analyst tends to write.
 */

import type { SwingAnalysis } from './poseDetection';

const NO_SWING_PHRASES = [
  'no player',
  'no person',
  'no human',
  'no swing visible',
  'no swing is visible',
  'no swing detected',
  'not in the shot',
  'not in the frame',
  'not in shot',
  'not in frame',
  'camera is pointed at',
  'camera pointed at',
  'pointed at the floor',
  'pointed at the ground',
  'pointed at the ceiling',
  'pointed at the sky',
  'too dark to',
  'frames are unreadable',
  'no analyzable swing',
];

export interface SwingValidity {
  valid: boolean;
  reason: string | null;
}

export function evaluateSwingValidity(analysis: SwingAnalysis | null): SwingValidity {
  if (!analysis) {
    return { valid: false, reason: 'No analysis available yet.' };
  }
  if (typeof analysis.valid_swing === 'boolean') {
    return {
      valid: analysis.valid_swing,
      reason: analysis.valid_swing ? null : (analysis.validity_reason ?? 'No analyzable swing detected.'),
    };
  }
  // Legacy fallback — sniff the observation text.
  const obs = (analysis.observation ?? '').toLowerCase();
  // Body-part guard: if the matched phrase appears within 20 chars of a body-part
  // word it's likely describing the player's anatomy ("hips not in the frame at
  // address"), not a no-player condition. Skip that phrase.
  const BODY_PART_RE = /\b(hip|shoulder|knee|elbow|wrist|foot|feet|head|arm|chest|back|hand|club)\b/i;
  const hit = NO_SWING_PHRASES.find(p => {
    const idx = obs.indexOf(p);
    if (idx < 0) return false;
    const window = obs.slice(Math.max(0, idx - 20), idx + p.length + 20);
    return !BODY_PART_RE.test(window);
  });
  if (hit) {
    return { valid: false, reason: capitalize(analysis.observation) };
  }
  return { valid: true, reason: null };
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * 2026-08-10 (Tim — "I'm so sick of the first read showing a couple things, showing weird numbers
 * for the readouts, and though it GIVES A READOUT, the little tile says 'no swing found, try
 * again'").
 *
 * THE CONTRADICTION. Two independent systems judge the same clip. On-device pose/biomech MEASURES
 * the swing (shoulder turn, hip turn, backswing and downswing timing). The server's vision pass
 * separately returns `valid_swing`. Only the server's opinion drove the verdict tile — so when the
 * vision call came back false while our own measurements had already produced a real shoulder turn
 * and a real tempo, the screen showed live metrics next to "NO SWING DETECTED". Both cannot be
 * true, and the one backed by measurements is the one that is right.
 *
 * The gate itself must stay — it exists because floor footage once produced a skeleton and an
 * "82 mph club speed" while the caddie correctly said no player was visible. So the override bar is
 * deliberately strict, and set where floor/ceiling/pocket footage cannot reach it: a real ROTATION
 * (a shoulder or hip turn of genuine swing magnitude, at usable confidence) AND real TIMING (a
 * plausible backswing/downswing split, or a tempo ratio in the range a human swing actually
 * occupies). A camera pointed at the carpet produces neither.
 */
export type MeasuredSwingEvidence = {
  shoulderTurnDeg?: number | null;
  hipTurnDeg?: number | null;
  /** 0..1 confidence the pose pipeline attaches to the shoulder-turn measurement. */
  shoulderConfidence?: number | null;
  backswingMs?: number | null;
  downswingMs?: number | null;
  tempoRatio?: number | null;
  /** How many frames actually carried a usable pose. */
  poseFrameCount?: number | null;
};

const MIN_SHOULDER_TURN_DEG = 45; // a real coil; camera noise doesn't manufacture this
const MIN_HIP_TURN_DEG = 20;
const MIN_POSE_FRAMES = 8;
const MIN_CONFIDENCE = 0.5;

/**
 * True when our OWN measurements prove a swing happened, independent of what the vision pass said.
 * Requires rotation AND timing — either alone is reachable by noise, together they are not.
 */
export function hasMeasuredSwing(e: MeasuredSwingEvidence | null | undefined): boolean {
  if (!e) return false;
  if ((e.poseFrameCount ?? 0) < MIN_POSE_FRAMES) return false;

  const conf = e.shoulderConfidence ?? 1;
  const rotated =
    (conf >= MIN_CONFIDENCE && (e.shoulderTurnDeg ?? 0) >= MIN_SHOULDER_TURN_DEG) ||
    (e.hipTurnDeg ?? 0) >= MIN_HIP_TURN_DEG;
  if (!rotated) return false;

  // Timing: a real split (backswing far longer than downswing) or a ratio in human range.
  const back = e.backswingMs ?? 0;
  const down = e.downswingMs ?? 0;
  const splitOk = back >= 300 && back <= 2_500 && down >= 80 && down <= 800 && back > down;
  const ratio = e.tempoRatio ?? 0;
  const ratioOk = ratio >= 1.5 && ratio <= 5;
  return splitOk || ratioOk;
}

/**
 * The validity the UI should act on: the vision verdict, overridden ONLY when our own measurements
 * contradict a false negative. A vision `valid_swing: true` is never downgraded here, and a false
 * with no measured evidence behind it still reads as invalid — so the floor-footage guard is intact.
 */
export function reconcileSwingValidity(
  analysis: SwingAnalysis | null,
  evidence: MeasuredSwingEvidence | null | undefined,
): SwingValidity {
  const base = evaluateSwingValidity(analysis);
  if (base.valid) return base;
  if (!hasMeasuredSwing(evidence)) return base;
  return {
    valid: true,
    // Kept non-null so surfaces that explain the read can say WHY we overrode the vision pass.
    reason: 'Vision pass found no swing, but on-device pose measured a real turn and tempo — trusting the measurement.',
  };
}
