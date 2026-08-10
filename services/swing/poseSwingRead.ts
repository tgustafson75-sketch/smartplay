/**
 * 2026-07-21 — POSE-FIRST swing read (the re-architecture: [[pose-first-analysis-rearchitecture]]).
 *
 * WHY: the swing read used to be a vision LLM guessing ONE fault from a few STILL frames of a fast
 * motion — unreliable, and it bailed to "no swing" when the stills were ambiguous. But the app
 * already MEASURES the swing's kinematics from pose (computeBiomechanicsFromFrames + deriveSwingTempo
 * produce hip turn, shoulder turn, tilt, weight shift, spine-angle change, hip-slide/sway, sequencing,
 * and tempo). This module turns those MEASUREMENTS into the read: a rich, multi-dimensional,
 * deterministic, HONEST evaluation — faults are thresholds on real numbers ("your hips slid off the
 * ball", not "looks like sway"), and every measured dimension gets a strength / watch / needs-work
 * verdict. It NEVER says "no swing": a dimension we couldn't measure from this angle is simply omitted
 * (honest), not a failure.
 *
 * Pose measures BODY kinematics reliably. It does NOT see the clubface / exact path / contact — those
 * stay vision-assisted + labeled (see the analysis pipeline); this module deliberately does not claim
 * them.
 *
 * Pure functions on already-computed measurements → fully unit-testable, no I/O, no native deps.
 */

import type { SwingBiomechanics, SwingTempo } from '../poseAnalysisApi';

export type DimensionVerdict = 'strength' | 'solid' | 'watch' | 'needs_work';

export interface DimensionRead {
  key: 'tempo' | 'hip_turn' | 'shoulder_turn' | 'weight_shift' | 'posture' | 'sway' | 'sequencing' | 'lead_arm' | 'chicken_wing' | 'finish' | 'head';
  label: string;
  /** Human value, e.g. "2.9 : 1", "46°", "+18%". Null when not measurable from this angle. */
  display: string | null;
  verdict: DimensionVerdict;
  /** One honest sentence grounded in the measurement. */
  note: string;
}

export interface PoseFault {
  /** Matches the canonical fault vocabulary where possible. */
  key: 'early_extension' | 'sway' | 'reverse_pivot' | 'over_the_top' | 'under_coil' | 'quick_tempo' | 'slow_tempo' | 'lead_arm_bent' | 'chicken_wing' | 'poor_finish' | 'head_movement';
  label: string;
  severity: 'minor' | 'moderate' | 'significant';
  /** The measurement that triggered it — the honest evidence. */
  evidence: string;
}

export interface PoseSwingRead {
  /** Every dimension we could measure, each with an honest verdict. */
  dimensions: DimensionRead[];
  /** Faults detected from thresholds on the measurements, most severe first. */
  faults: PoseFault[];
  /** 1-2 genuine strengths (dimensions that graded 'strength'). */
  strengths: string[];
  /** The single headline: the top fault, or the standout strength when the swing is clean. */
  headline: string;
  /** True when at least one dimension was measurable — the pose read is usable. */
  usable: boolean;
}

// ── Tour-grounded reference bands (honest, coach-eyeball level, not launch-monitor precision) ──
// Each band: an ideal window; outside it degrades to watch / needs_work.
const sev = (rank: number): PoseFault['severity'] => (rank >= 2 ? 'significant' : rank === 1 ? 'moderate' : 'minor');

function tempoRead(t: SwingTempo | null): DimensionRead | null {
  if (!t || t.ratio == null) return null;
  const r = t.ratio;
  const display = `${r.toFixed(1)} : 1`;
  // Classic tour ratio ≈ 3:1. 2.6–3.6 is a healthy range.
  if (r >= 2.6 && r <= 3.6) return { key: 'tempo', label: 'Tempo', display, verdict: r >= 2.8 && r <= 3.4 ? 'strength' : 'solid', note: `Backswing-to-downswing ${display} — right in the tour range (~3:1).` };
  if (r < 2.6) return { key: 'tempo', label: 'Tempo', display, verdict: r < 2.1 ? 'needs_work' : 'watch', note: `${display} — quick transition; the downswing is rushing the backswing.` };
  return { key: 'tempo', label: 'Tempo', display, verdict: r > 4.1 ? 'needs_work' : 'watch', note: `${display} — slow, deliberate transition; a touch more pace through the ball can help.` };
}

function bandRead(
  key: DimensionRead['key'], label: string, deg: number | null, unit: string,
  idealLo: number, idealHi: number, lowNote: string, highNote: string, okNote: string,
): DimensionRead | null {
  if (deg == null) return null;
  const display = `${Math.round(deg)}${unit}`;
  if (deg >= idealLo && deg <= idealHi) return { key, label, display, verdict: 'strength', note: `${display} — ${okNote}` };
  if (deg < idealLo) return { key, label, display, verdict: deg < idealLo * 0.7 ? 'needs_work' : 'watch', note: `${display} — ${lowNote}` };
  return { key, label, display, verdict: deg > idealHi * 1.3 ? 'needs_work' : 'watch', note: `${display} — ${highNote}` };
}

/**
 * Build the pose-first read from the measured biomechanics + tempo. Both come from the pose pipeline
 * (computeBiomechanicsFromFrames / deriveSwingTempo). Everything here is deterministic + honest:
 * a null measurement → the dimension is omitted (not guessed), and a fault is asserted only when a
 * real measurement clears a threshold.
 */
export function buildPoseSwingRead(bio: SwingBiomechanics | null, tempo: SwingTempo | null): PoseSwingRead {
  const dims: DimensionRead[] = [];
  const faults: PoseFault[] = [];
  // 2026-08-06 (Tim — "super tight" mechanics). Only escalate a metric to a headline FAULT when the pose
  // was actually confident about it. A low-confidence read still shows as a (hedged) dimension, but we don't
  // lead with a scold we're not sure of — the top-line verdict stays trustworthy. (0.4 ≈ usable-but-soft.)
  const conf = bio?.metric_confidence ?? {};
  // 2026-08-06 (analysis audit) — default UNKNOWN confidence to 0 (untrusted), not 1 (trusted). A missing/
  // null metric_confidence (legacy biomech, or avgScore returned null because the joints weren't clearly
  // seen) must NOT let a fault jump to the headline scold ungated — that's exactly the false-confidence Tim
  // said to kill. Unknown → show the hedged dimension, don't lead with the fault. (0.4 ≈ usable-but-soft.)
  const trust = (v?: number | null) => (v ?? 0) >= 0.4;

  const tRead = tempoRead(tempo);
  if (tRead) {
    dims.push(tRead);
    if (tempo?.ratio != null && tempo.ratio < 2.1) faults.push({ key: 'quick_tempo', label: 'Quick transition', severity: 'moderate', evidence: `Tempo ${tempo.ratio.toFixed(1)}:1 (tour ≈ 3:1) — the downswing starts before the backswing finishes.` });
    else if (tempo?.ratio != null && tempo.ratio > 4.1) faults.push({ key: 'slow_tempo', label: 'Slow transition', severity: 'minor', evidence: `Tempo ${tempo.ratio.toFixed(1)}:1 — slower than the ~3:1 tour rhythm.` });
  }

  const hip = bio ? bandRead('hip_turn', 'Hip turn', bio.hipTurnDeg, '°', 35, 55, 'restricted hip turn — limits your coil and power.', 'big hip turn — watch you\'re still loading into the trail side, not sliding.', 'a strong, athletic hip turn.') : null;
  if (hip) dims.push(hip);

  const sh = bio ? bandRead('shoulder_turn', 'Shoulder turn', bio.shoulderTurnDeg, '°', 80, 105, 'under-coiled — a fuller shoulder turn adds width and speed.', 'a very full turn — fine if you stay in posture.', 'a full tour-length shoulder coil.') : null;
  if (sh) dims.push(sh);
  if (bio?.shoulderTurnDeg != null && bio.shoulderTurnDeg < 65 && trust(conf.shoulderTurn)) faults.push({ key: 'under_coil', label: 'Under-coiled backswing', severity: sev(bio.shoulderTurnDeg < 55 ? 1 : 0), evidence: `Shoulder turn ${Math.round(bio.shoulderTurnDeg)}° (tour ~90°) — you're leaving coil (and speed) on the table.` });

  // Weight shift: positive % = weight moving to the lead side at impact (good). Near-zero / negative
  // = hanging back / reverse pivot.
  if (bio?.weightShiftPct != null) {
    const w = bio.weightShiftPct;
    const display = `${w > 0 ? '+' : ''}${Math.round(w)}%`;
    if (w >= 12) dims.push({ key: 'weight_shift', label: 'Weight shift', display, verdict: 'strength', note: `${display} onto your lead side at impact — you're driving through the ball.` });
    else if (w >= 4) dims.push({ key: 'weight_shift', label: 'Weight shift', display, verdict: 'solid', note: `${display} forward — moving in the right direction; a touch more drive adds compression.` });
    else {
      dims.push({ key: 'weight_shift', label: 'Weight shift', display, verdict: w < -4 ? 'needs_work' : 'watch', note: `${display} — your weight is hanging back through impact instead of driving forward.` });
      if (trust(conf.weightShift)) faults.push({ key: 'reverse_pivot', label: 'Weight hanging back', severity: sev(w < -8 ? 2 : w < 0 ? 1 : 0), evidence: `Weight shift ${display} at impact — you're not getting onto your lead side (power + strike suffer).` });
    }
  }

  // Posture / spine-angle preservation: a large change from address to impact = standing up = early
  // extension. Small change = posture held.
  if (bio?.spineAngleDeltaDeg != null) {
    const s = Math.abs(bio.spineAngleDeltaDeg);
    const display = `${Math.round(s)}°`;
    if (s <= 8) dims.push({ key: 'posture', label: 'Posture', display, verdict: 'strength', note: `Spine angle held within ${display} through impact — you're keeping your posture.` });
    else {
      dims.push({ key: 'posture', label: 'Posture', display, verdict: s > 16 ? 'needs_work' : 'watch', note: `Spine angle changed ${display} from address to impact — you're standing up out of your posture.` });
      if (trust(conf.spineAngleDelta)) faults.push({ key: 'early_extension', label: 'Early extension', severity: sev(s > 18 ? 2 : s > 12 ? 1 : 0), evidence: `Spine angle rose ${display} into impact — your hips push toward the ball and you lose your spine angle.` });
    }
  }

  // SWAY (rebuilt 2026-08-09) — hip-MIDPOINT lateral translation address→top as a fraction of shoulder
  // width. The old hipSlideRatio (single hip ÷ noisy rotation proxy) divided real sway away on a good
  // turn (Tim: "misses sway my eyes see"). ~0.15 watch, ~0.20 fault, ~0.28 significant.
  if (bio?.swayNorm != null) {
    const v = bio.swayNorm;
    const display = `${Math.round(v * 100)}%`;
    if (v <= 0.15) dims.push({ key: 'sway', label: 'Hip stability', display, verdict: 'strength', note: `Hips stayed stacked over the ball (${display} drift) — a centered turn around a post.` });
    else {
      dims.push({ key: 'sway', label: 'Hip stability', display, verdict: v > 0.22 ? 'needs_work' : 'watch', note: `Your hips slid ${display} of shoulder-width off the ball in the backswing.` });
      if (trust(conf.sway)) faults.push({ key: 'sway', label: 'Sway off the ball', severity: sev(v > 0.28 ? 2 : v > 0.20 ? 1 : 0), evidence: `Hips slid ${display} of shoulder-width off the ball — swaying laterally instead of turning around a centered post.` });
    }
  }

  // 2026-08-09 (elite fault engine — Tim's named misses). Over-the-top is NO LONGER asserted from the
  // hip/shoulder width "sequencing" proxy — two static endpoint frames on the face-on plane cannot
  // measure transition ORDER or club PLANE, so it was fabricated (Tim: correct). Real over-the-top
  // needs the clubhead PATH (DTL) — queued to derive from the already-extracted club arc. Until then we
  // stay silent rather than fabricate. In its place: the ARM + FINISH faults the golfer plainly sees.

  // LEAD ARM at the top — a straight lead arm keeps width; bent = collapsed radius.
  if (bio?.leadArmTopDeg != null) {
    const a = bio.leadArmTopDeg;
    if (a >= 155) dims.push({ key: 'lead_arm', label: 'Lead arm', display: `${a}°`, verdict: 'strength', note: `Lead arm straight (${a}°) at the top — wide and connected.` });
    else {
      dims.push({ key: 'lead_arm', label: 'Lead arm', display: `${a}°`, verdict: a < 140 ? 'needs_work' : 'watch', note: `Lead arm bent to ${a}° at the top — losing width and arc radius.` });
      if (trust(conf.leadArm)) faults.push({ key: 'lead_arm_bent', label: 'Bent lead arm', severity: sev(a < 135 ? 2 : a < 148 ? 1 : 0), evidence: `Lead arm bent to ${a}° at the top (a wide swing holds ~165°+) — the collapsed radius costs width, speed and a consistent low point.` });
    }
  }

  // CHICKEN WING — lead arm folding through impact/early follow-through (loss of extension + face control).
  if (bio?.leadArmImpactDeg != null) {
    const a = bio.leadArmImpactDeg;
    if (a >= 150) dims.push({ key: 'chicken_wing', label: 'Extension', display: `${a}°`, verdict: 'strength', note: `Lead arm extending (${a}°) through impact — a full release.` });
    else {
      dims.push({ key: 'chicken_wing', label: 'Extension', display: `${a}°`, verdict: a < 135 ? 'needs_work' : 'watch', note: `Lead arm folding to ${a}° through impact.` });
      if (trust(conf.chickenWing)) faults.push({ key: 'chicken_wing', label: 'Chicken wing', severity: sev(a < 130 ? 2 : a < 145 ? 1 : 0), evidence: `Lead arm folded to ${a}° through impact — a chicken wing; you're losing extension and control of the face (weak, blocked or scooped strikes).` });
    }
  }

  // FINISH — weight through onto the lead side at the finish frame; low = falling back / incomplete.
  if (bio?.finishWeightPct != null) {
    const w = bio.finishWeightPct;
    const display = `${w >= 0 ? '+' : ''}${w}%`;
    if (w >= 25) dims.push({ key: 'finish', label: 'Finish', display, verdict: 'strength', note: `Balanced finish — weight ${display} onto the lead side, fully through.` });
    else {
      dims.push({ key: 'finish', label: 'Finish', display, verdict: w < 5 ? 'needs_work' : 'watch', note: `Weight ${display} at the finish — not getting all the way through.` });
      if (trust(conf.finish)) faults.push({ key: 'poor_finish', label: 'Incomplete finish', severity: sev(w < 0 ? 2 : w < 10 ? 1 : 0), evidence: `Weight only ${display} onto the lead side at the finish — you're falling back instead of finishing balanced and rotated over your lead leg.` });
    }
  }

  // HEAD MOVEMENT — headDriftPxNorm was computed and orphaned; wire it. >~0.06 of frame height =
  // meaningful head travel address→impact (excess sway/lift hurts low-point control).
  if (bio?.headDriftPxNorm != null) {
    const d = bio.headDriftPxNorm;
    const display = `${Math.round(d * 100)}%`;
    if (d <= 0.05) dims.push({ key: 'head', label: 'Head', display, verdict: 'strength', note: `Head stayed quiet (${display} of frame) — a steady center to swing around.` });
    else {
      dims.push({ key: 'head', label: 'Head', display, verdict: d > 0.09 ? 'needs_work' : 'watch', note: `Head moved ${display} of the frame from address to impact.` });
      if (trust(conf.headDrift)) faults.push({ key: 'head_movement', label: 'Head movement', severity: sev(d > 0.11 ? 2 : d > 0.07 ? 1 : 0), evidence: `Head drifted ${display} of the frame from address to impact — excess movement makes the low point (and strike) inconsistent.` });
    }
  }

  faults.sort((a, b) => sevRank(b.severity) - sevRank(a.severity));
  const strengths = dims.filter((d) => d.verdict === 'strength').map((d) => d.note);

  let headline: string;
  if (faults.length > 0) headline = faults[0].label;
  else if (strengths.length > 0) headline = 'Clean, well-sequenced swing';
  else headline = 'Swing captured';

  return { dimensions: dims, faults, strengths: strengths.slice(0, 2), headline, usable: dims.length > 0 };
}

function sevRank(s: PoseFault['severity']): number {
  return s === 'significant' ? 2 : s === 'moderate' ? 1 : 0;
}
