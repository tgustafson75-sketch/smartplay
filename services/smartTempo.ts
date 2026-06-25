/**
 * 2026-06-24 — Smart Tempo engine.
 *
 * The honest tempo-analysis core. Replaces the abstract metronome
 * (app/swinglab/tempo-trainer.tsx, a fixed-ratio audio drill with NO
 * measurement) with a REAL read: from three swing-phase timestamps —
 * backswing-start, top-of-backswing, impact — compute the player's
 * ACTUAL backswing:downswing tempo ratio and grade it against the
 * tour-standard 3:1.
 *
 * Modeled on Tim's TempoTouch prototype, but with AUTO-DETECTION from
 * the signals SmartPlay already produces:
 *   • IMPACT — the acoustic strike anchor. services/acousticImpactDetector
 *     returns ImpactReading.impact_ms (offset ms from recording start),
 *     precise to the audio sample. This is the most reliable phase and
 *     the one we seed first.
 *   • TOP-OF-BACKSWING + BACKSWING-START — read from pose. We track the
 *     lead hands (wrist keypoints) across the backswing window: hands
 *     highest (minimum wrist-y, since image y grows downward) = the top
 *     (the velocity/direction reversal); backswing-start = the first
 *     frame the hands rose meaningfully off address height (motion onset).
 *     This mirrors the proven logic already in
 *     services/poseAnalysisApi.ts → deriveSwingTempo().
 *
 * HONESTY: only real signals. computeTempo is pure and refuses invalid
 * orderings. detectTempoPhases is BEST-EFFORT — it returns only the
 * phases it can actually derive from the supplied signals and leaves the
 * rest undefined for the user to scrub-to-mark in the UI. It never
 * fabricates a timestamp and never throws.
 *
 * The 3:1 target + "X.X:1" framing match the tempo trainer's PRESETS
 * (back/down ratios all land on 3.0:1) so the language stays consistent
 * across the two surfaces.
 */

import type { PoseFrame } from './poseAnalysisApi';
import type { ImpactReading } from './acousticImpactDetector';

// ─── Public types ──────────────────────────────────────────────────────

/** The three real timestamps a tempo read is built from, in SECONDS
 *  relative to the same clock (clip start). Must satisfy
 *  backswingStartSec < topSec < impactSec. */
export interface TempoPhases {
  /** Motion onset — the hands first leave address. */
  backswingStartSec: number;
  /** Top of the backswing — the transition / direction reversal. */
  topSec: number;
  /** Strike — the acoustic impact instant. */
  impactSec: number;
}

export type TempoRating = 'rushed' | 'smooth' | 'on_tempo' | 'slow';

export interface TempoResult {
  backswingMs: number;
  downswingMs: number;
  /** Raw backswing:downswing ratio (backswingMs / downswingMs). */
  ratio: number;
  /** Formatted to one decimal, e.g. "2.4:1". */
  ratioLabel: string;
  rating: TempoRating;
  /** Human label for the rating, e.g. "On Tempo". */
  ratingLabel: string;
  /** One short, honest coaching cue for this rating. */
  coaching: string;
  /** The tour-standard target this read is graded against. Always 3. */
  targetRatio: 3;
}

// ─── Rating thresholds ─────────────────────────────────────────────────
// Graded against the tour-standard 3:1 (backswing is ~3x the downswing).
//
//   ratio < 2.7          → 'rushed'   (downswing too quick vs the backswing
//                                       — the common amateur fault)
//   2.7 ≤ ratio ≤ 3.3    → 'on_tempo' (right in the tour band)
//   3.3 < ratio < 3.4    → 'smooth'   (a touch long but still fluid)
//   ratio ≥ 3.4          → 'slow'     (load is long / downswing too slow)
//
// 'smooth' is the narrow honest band just above on-tempo: the load is
// slightly long but the transition is still unhurried (a forgivable,
// often-deliberate pattern) — distinct from a genuinely 'slow' tempo
// where the downswing lags.
const ON_TEMPO_LOW = 2.7;
const ON_TEMPO_HIGH = 3.3;
const SMOOTH_HIGH = 3.4;

const RATING_META: Record<TempoRating, { label: string; coaching: string }> = {
  rushed: {
    label: 'Rushed',
    coaching: 'Slow your load slightly — let the club finish the backswing before you fire.',
  },
  on_tempo: {
    label: 'On Tempo',
    coaching: 'Right on tempo — repeat it.',
  },
  smooth: {
    label: 'Smooth',
    coaching: 'Smooth and unhurried — a hair long on the load, but a clean transition.',
  },
  slow: {
    label: 'Slow',
    coaching: 'Your downswing is lagging the load — match the backswing with a more decisive transition.',
  },
};

function ratingFor(ratio: number): TempoRating {
  if (ratio < ON_TEMPO_LOW) return 'rushed';
  if (ratio <= ON_TEMPO_HIGH) return 'on_tempo';
  if (ratio < SMOOTH_HIGH) return 'smooth';
  return 'slow';
}

/**
 * Pure tempo computation from three real phase timestamps. Returns null
 * when the ordering is invalid (start < top < impact must hold) or any
 * phase duration is ≤ 0 — we never fabricate a ratio from a bad read.
 */
export function computeTempo(phases: TempoPhases): TempoResult | null {
  const { backswingStartSec, topSec, impactSec } = phases;
  if (
    !Number.isFinite(backswingStartSec) ||
    !Number.isFinite(topSec) ||
    !Number.isFinite(impactSec)
  ) {
    return null;
  }
  // Strict ordering — a backswing must precede the top, which must
  // precede impact.
  if (!(backswingStartSec < topSec && topSec < impactSec)) return null;

  const backswingMs = (topSec - backswingStartSec) * 1000;
  const downswingMs = (impactSec - topSec) * 1000;
  if (backswingMs <= 0 || downswingMs <= 0) return null;

  const ratio = backswingMs / downswingMs;
  if (!Number.isFinite(ratio) || ratio <= 0) return null;

  const rating = ratingFor(ratio);
  const meta = RATING_META[rating];

  return {
    backswingMs: Math.round(backswingMs),
    downswingMs: Math.round(downswingMs),
    ratio,
    ratioLabel: `${ratio.toFixed(1)}:1`,
    rating,
    ratingLabel: meta.label,
    coaching: meta.coaching,
    targetRatio: 3,
  };
}

// ─── Auto-detection ────────────────────────────────────────────────────

/**
 * Input for best-effort auto-seeding. Both fields are optional — pass
 * whatever the swing actually produced.
 *
 *   • acoustic — an ImpactReading (from acousticImpactDetector's
 *     stopAndDetectImpact / getLastImpactReading) carrying impact_ms
 *     (offset ms from recording start). When present this seeds the most
 *     reliable phase: IMPACT.
 *   • poseFrames — per-frame poses (PoseFrame[] from poseAnalysisApi /
 *     mediaPipePoseService) sampled across the swing, each with a
 *     timestampMs and wrist keypoints. Used to derive TOP (wrist-y
 *     reversal) and BACKSWING-START (motion onset). Should be densely
 *     sampled across the backswing window for a reliable reversal; sparse
 *     fixed-position keyframes (e.g. the 5 in SwingBiomechanics.frames)
 *     are NOT enough to find a clean apex.
 *   • impactMs — an explicit impact offset (ms from clip start), if the
 *     caller has it from somewhere other than ImpactReading. Takes
 *     precedence over acoustic.impact_ms when both are given.
 *   • clipStartMs — offset (ms) of the swing's clip-start within the
 *     recording, when the pose timestamps and the acoustic impact_ms are
 *     on different zero points (e.g. a windowed swing inside a
 *     multi-swing master). Subtracted from impact_ms to align. Defaults
 *     to 0 (both clocks share a start).
 */
export interface DetectTempoInput {
  acoustic?: Pick<ImpactReading, 'impact_ms'> | null;
  poseFrames?: PoseFrame[] | null;
  impactMs?: number | null;
  clipStartMs?: number | null;
}

export interface DetectTempoOutput {
  phases: Partial<TempoPhases>;
  /** 'auto'    — all three phases derived from real signal.
   *  'partial' — at least one phase derived (commonly impact only).
   *  'none'    — nothing derivable; phases is empty. */
  confidence: 'auto' | 'partial' | 'none';
}

// Lead-wrist y at a frame (average of the two wrists that are present
// with usable confidence). Image y grows downward, so a SMALLER value =
// hands higher. Null when neither wrist is usable.
const WRIST_SCORE_FLOOR = 0.3;

function wristY(frame: PoseFrame): number | null {
  const ys: number[] = [];
  for (const k of frame.keypoints) {
    if (k.name !== 'left_wrist' && k.name !== 'right_wrist') continue;
    if (typeof k.y !== 'number' || !Number.isFinite(k.y)) continue;
    if (typeof k.score === 'number' && k.score < WRIST_SCORE_FLOOR) continue;
    ys.push(k.y);
  }
  if (ys.length === 0) return null;
  return ys.reduce((a, b) => a + b, 0) / ys.length;
}

/**
 * Best-effort auto-seed of the tempo phases from real signals. Returns
 * only what it can derive; undetected phases are left undefined for the
 * user to scrub-to-mark. Never throws — any failure yields
 * { phases: {}, confidence: 'none' }.
 *
 * Strategy:
 *   1. IMPACT (most reliable) from the acoustic strike. Always seeded
 *      first when available.
 *   2. TOP + BACKSWING-START from the pose wrist-y series: the interior
 *      minimum-y frame is the top (reversal); the first frame the hands
 *      rose meaningfully off address height is the onset. Mirrors
 *      deriveSwingTempo() in poseAnalysisApi.ts.
 *
 * Confidence is 'auto' when all three phases came out, 'partial' when
 * some did, 'none' when nothing could be read.
 */
export function detectTempoPhases(input: DetectTempoInput): DetectTempoOutput {
  try {
    const phases: Partial<TempoPhases> = {};
    const clipStartMs = typeof input.clipStartMs === 'number' && Number.isFinite(input.clipStartMs)
      ? input.clipStartMs
      : 0;

    // ── 1. Impact (acoustic) ────────────────────────────────────────
    const rawImpactMs =
      typeof input.impactMs === 'number' && Number.isFinite(input.impactMs)
        ? input.impactMs
        : typeof input.acoustic?.impact_ms === 'number' && Number.isFinite(input.acoustic.impact_ms)
          ? input.acoustic.impact_ms
          : null;
    let impactSec: number | null = null;
    if (rawImpactMs != null) {
      const alignedMs = rawImpactMs - clipStartMs;
      if (alignedMs > 0) {
        impactSec = alignedMs / 1000;
        phases.impactSec = impactSec;
      }
    }

    // ── 2. Top + backswing-start (pose) ─────────────────────────────
    const frames = (input.poseFrames ?? [])
      .filter((f): f is PoseFrame => !!f && typeof f.timestampMs === 'number')
      .slice()
      .sort((a, b) => a.timestampMs - b.timestampMs);

    if (frames.length >= 4) {
      // Build the wrist-y series. Restrict to frames before impact (when
      // known) so the downswing/follow-through can't masquerade as a
      // second "top".
      const series: { t: number; y: number }[] = [];
      for (const f of frames) {
        if (impactSec != null && f.timestampMs / 1000 >= impactSec) break;
        const y = wristY(f);
        if (y == null) continue;
        series.push({ t: f.timestampMs / 1000, y });
      }

      if (series.length >= 4) {
        // Top of backswing = hands highest = minimum y, interior only
        // (a real reversal can't be the first or last sample).
        let topIdx = 0;
        for (let i = 1; i < series.length; i++) {
          if (series[i].y < series[topIdx].y) topIdx = i;
        }
        if (topIdx > 0 && topIdx < series.length - 1) {
          const topSec = series[topIdx].t;

          // Backswing-start = first frame the hands rose meaningfully
          // off address (first-sample) height. Threshold scales to the
          // observed travel so it's robust to normalized-vs-pixel coords.
          const addressY = series[0].y;
          const travel = addressY - series[topIdx].y; // positive: hands went up
          let startSec: number | null = null;
          if (travel > 0) {
            const onsetDelta = travel * 0.2;
            for (let i = 0; i <= topIdx; i++) {
              if (addressY - series[i].y >= onsetDelta) {
                startSec = series[i].t;
                break;
              }
            }
          }

          // Only commit phases that keep a strictly increasing order
          // against whatever else we have. Never emit an out-of-order
          // seed — the UI would then build an invalid ratio.
          if (impactSec == null || topSec < impactSec) {
            phases.topSec = topSec;
            if (startSec != null && startSec < topSec) {
              phases.backswingStartSec = startSec;
            }
          }
        }
      }
    }

    const detected =
      (phases.backswingStartSec != null ? 1 : 0) +
      (phases.topSec != null ? 1 : 0) +
      (phases.impactSec != null ? 1 : 0);

    const confidence: DetectTempoOutput['confidence'] =
      detected === 3 ? 'auto' : detected > 0 ? 'partial' : 'none';

    return { phases, confidence };
  } catch {
    return { phases: {}, confidence: 'none' };
  }
}

// ─── Replay-at-tempo helper ────────────────────────────────────────────

/**
 * Frame counts for the tour-standard 3:1 segments at a given capture
 * fps, for a "replay at tempo" overlay (matches the tempo trainer's
 * frame framing — e.g. 24/8 @ 30fps for the Standard preset). Returns
 * backswing + downswing frame counts plus the total.
 *
 * Defaults to the trainer's "Standard" tempo (24 backswing frames @
 * 30fps = 800ms) so the two surfaces line up.
 */
export function tempoTargetFrames(
  fps = 30,
  opts?: { backswingMs?: number },
): { backswingFrames: number; downswingFrames: number; totalFrames: number } {
  const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 30;
  // Standard preset = 800ms backswing, 3:1 → ~267ms downswing.
  const backswingMs = opts?.backswingMs && opts.backswingMs > 0 ? opts.backswingMs : 800;
  const downswingMs = backswingMs / 3;
  const backswingFrames = Math.round((backswingMs / 1000) * safeFps);
  const downswingFrames = Math.round((downswingMs / 1000) * safeFps);
  return {
    backswingFrames,
    downswingFrames,
    totalFrames: backswingFrames + downswingFrames,
  };
}
