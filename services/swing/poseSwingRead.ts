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
  key: 'tempo' | 'hip_turn' | 'shoulder_turn' | 'weight_shift' | 'posture' | 'sway' | 'sequencing';
  label: string;
  /** Human value, e.g. "2.9 : 1", "46°", "+18%". Null when not measurable from this angle. */
  display: string | null;
  verdict: DimensionVerdict;
  /** One honest sentence grounded in the measurement. */
  note: string;
}

export interface PoseFault {
  /** Matches the canonical fault vocabulary where possible. */
  key: 'early_extension' | 'sway' | 'reverse_pivot' | 'over_the_top' | 'under_coil' | 'quick_tempo' | 'slow_tempo';
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
  if (bio?.shoulderTurnDeg != null && bio.shoulderTurnDeg < 65) faults.push({ key: 'under_coil', label: 'Under-coiled backswing', severity: sev(bio.shoulderTurnDeg < 55 ? 1 : 0), evidence: `Shoulder turn ${Math.round(bio.shoulderTurnDeg)}° (tour ~90°) — you're leaving coil (and speed) on the table.` });

  // Weight shift: positive % = weight moving to the lead side at impact (good). Near-zero / negative
  // = hanging back / reverse pivot.
  if (bio?.weightShiftPct != null) {
    const w = bio.weightShiftPct;
    const display = `${w > 0 ? '+' : ''}${Math.round(w)}%`;
    if (w >= 12) dims.push({ key: 'weight_shift', label: 'Weight shift', display, verdict: 'strength', note: `${display} onto your lead side at impact — you're driving through the ball.` });
    else if (w >= 4) dims.push({ key: 'weight_shift', label: 'Weight shift', display, verdict: 'solid', note: `${display} forward — moving in the right direction; a touch more drive adds compression.` });
    else {
      dims.push({ key: 'weight_shift', label: 'Weight shift', display, verdict: w < -4 ? 'needs_work' : 'watch', note: `${display} — your weight is hanging back through impact instead of driving forward.` });
      faults.push({ key: 'reverse_pivot', label: 'Weight hanging back', severity: sev(w < -8 ? 2 : w < 0 ? 1 : 0), evidence: `Weight shift ${display} at impact — you're not getting onto your lead side (power + strike suffer).` });
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
      faults.push({ key: 'early_extension', label: 'Early extension', severity: sev(s > 18 ? 2 : s > 12 ? 1 : 0), evidence: `Spine angle rose ${display} into impact — your hips push toward the ball and you lose your spine angle.` });
    }
  }

  // Sway: hipSlideRatio > 1 = hips sliding laterally off the ball more than rotating in the backswing.
  if (bio?.hipSlideRatio != null) {
    const r = bio.hipSlideRatio;
    const display = r.toFixed(1);
    if (r <= 1.05) dims.push({ key: 'sway', label: 'Hip stability', display: `${display}×`, verdict: 'strength', note: `Your hips rotate more than they slide (${display}×) — a stable, centered turn.` });
    else {
      dims.push({ key: 'sway', label: 'Hip stability', display: `${display}×`, verdict: r > 1.4 ? 'needs_work' : 'watch', note: `Your hips slide off the ball ${display}× more than they rotate in the backswing.` });
      faults.push({ key: 'sway', label: 'Sway off the ball', severity: sev(r > 1.5 ? 2 : r > 1.25 ? 1 : 0), evidence: `Hip slide ${display}× rotation — you're swaying laterally instead of turning around a centered post.` });
    }
  }

  // Sequencing: hips-lead-the-downswing score (0..100). High = tour kinematic sequence; low = shoulders
  // start it = over the top.
  if (bio?.sequencingScore != null) {
    const q = bio.sequencingScore;
    const display = `${Math.round(q)}`;
    if (q >= 60) dims.push({ key: 'sequencing', label: 'Sequence', display, verdict: 'strength', note: `Your hips lead the downswing (${display}/100) — the tour kinematic order.` });
    else {
      dims.push({ key: 'sequencing', label: 'Sequence', display, verdict: q < 40 ? 'needs_work' : 'watch', note: `Your upper body is starting the downswing (${display}/100) instead of the hips leading.` });
      faults.push({ key: 'over_the_top', label: 'Over the top', severity: sev(q < 35 ? 2 : q < 50 ? 1 : 0), evidence: `Sequencing ${display}/100 — the shoulders fire first, throwing the club over the plane.` });
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
