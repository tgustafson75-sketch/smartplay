/**
 * 2026-05-23 — Swing metrics synthesis.
 *
 * Replaces SmartMotion's hard-coded placeholder values
 * ('82' / '113' / '1.37' / '156') with a real estimator that:
 *   1. Prefers MEASURED signals when available (Galaxy Watch IMU
 *      via watchStore.sessionSwings, acoustic ball-speed from
 *      /api/acoustic-detect)
 *   2. Falls back to POSE-DERIVED estimates from MediaPipe wrist
 *      keypoint velocity at impact (the diagnostic moment is
 *      already sampled at P6 by the existing keyframe pipeline)
 *   3. Falls back to PROFILE-BASED estimates from playerProfile's
 *      typical club distances + handicap when neither measured
 *      nor pose data is available
 *   4. Surfaces a `source` field per metric so the UI can render
 *      "Smash 1.41 • measured" vs "Smash 1.37 • est" honestly
 *
 * Smash factor = ball_speed / club_speed, computed ONLY when both
 * upstream metrics have a usable source. Never synthesizes from
 * thin air — null when the data isn't there.
 *
 * Carry yardage prefers profile.clubDistances[club] when populated
 * (player's actual typical carry for the matched club); falls back
 * to a club-vs-club-speed regression for unknown clubs.
 *
 * Backward compatible: every consumer that read the old hard-coded
 * strings now reads a SwingMetricSet object — the previous strings
 * were unattributed so every caller already treated them as
 * placeholder. Migration is purely additive at the call site.
 */

import type { PoseFrame } from './poseAnalysisApi';
import { devLog } from './devLog';

// ─── Types ───────────────────────────────────────────────────────────

export type MetricSource =
  | 'measured'         // Galaxy Watch IMU, acoustic ball-speed, etc.
  | 'pose_estimated'   // Derived from MediaPipe / cloud pose at P6 impact
  | 'profile_estimated'// Pulled from player profile typical distances
  | 'placeholder';     // Fallback when nothing else available

export interface SwingMetric {
  /** Numeric value when present; null when unknown OR when inputs
   *  were degenerate enough that any number would be a lie (see the
   *  "kill silent clamp" rules in clubSpeedFromPose). */
  value: number | null;
  /** Unit string for display ('mph', 'yds', or '' for ratios). */
  unit: string;
  /** Where this number came from — drives the UI's "est" badge. */
  source: MetricSource;
  /** 0..1 — engine's confidence in the value. Continuous for upstream
   *  math; the discrete `confidenceLabel` is what the UI renders. */
  confidence: number;
  /** 2026-05-24 — Discrete confidence bucket the UI consumes. Derived
   *  from `confidence` via `bucketize()`. Compounding gates downgrade
   *  it (smash/carry inherit the worst of their parents). 'high' is
   *  reserved for measured inputs; pose-derived metrics ceiling at
   *  'med' even with clean keypoints. */
  confidenceLabel: 'high' | 'med' | 'low';
  /** 2026-05-24 — [lo, hi] estimated range in the metric's unit.
   *  Null when (a) the source is 'measured' (no range needed — it's
   *  the truth), (b) the value itself is null, or (c) the range
   *  would be wider than usefully informative. The UI shows this
   *  when present so the user never sees a bare confident number
   *  from a pose heuristic that can't back it up. */
  range: [number, number] | null;
  /** 2026-05-24 — Short methodology label, mirrors Cage Mode's
   *  "(single-mic, club-typical × peak)" pattern. Surfaces next to
   *  the value so the estimate is honest about HOW it was derived. */
  estimateNote?: string;
}

// 2026-05-24 — Map continuous confidence into the discrete bucket the
// UI consumes. Thresholds chosen so:
//   high — only reachable when an actual sensor (watch IMU / acoustic
//          / launch monitor) produced the value
//   med  — pose-derived with clean keypoints + plausible raw value
//   low  — pose-derived with noisy inputs OR out-of-band raw value OR
//          any compounded metric whose parent was low
function bucketize(confidence: number): 'high' | 'med' | 'low' {
  if (confidence >= 0.70) return 'high';
  if (confidence >= 0.45) return 'med';
  return 'low';
}

// 2026-05-24 — Per-source range factor as a fraction of the value.
// Range is `[value × (1 - factor), value × (1 + factor)]` so the user
// reads "~92 mph (78–105)" rather than a bare number that masks the
// 20% error band a 2D pose heuristic actually carries. Wider on low
// confidence; collapsed entirely on measured (range = null at caller).
function rangeFactor(source: MetricSource, label: 'high' | 'med' | 'low'): number {
  if (source === 'measured') return 0; // caller passes null range
  if (source === 'placeholder') return 0.25;
  // pose_estimated / profile_estimated
  if (label === 'high') return 0.12;
  if (label === 'med')  return 0.18;
  return 0.25;
}

function rangeFor(value: number | null, source: MetricSource, label: 'high' | 'med' | 'low', unit: string): [number, number] | null {
  if (value == null) return null;
  if (source === 'measured') return null; // truth — no range needed
  const f = rangeFactor(source, label);
  if (f <= 0) return null;
  const lo = value * (1 - f);
  const hi = value * (1 + f);
  // Ratios (smash) round to 2 decimals; mph/yds to int.
  if (unit === '') {
    return [Math.round(lo * 100) / 100, Math.round(hi * 100) / 100];
  }
  return [Math.round(lo), Math.round(hi)];
}

export interface SwingMetricSet {
  club_speed: SwingMetric;
  ball_speed: SwingMetric;
  smash_factor: SwingMetric;
  carry_yards: SwingMetric;
}

export interface SwingMetricInputs {
  /** Pose frames extracted from the clip (P1/P2/P4/P6/P10 expected).
   *  When present, P6 impact keypoint velocities feed the pose-
   *  estimated path. */
  poseFrames?: PoseFrame[] | null;
  /** Total clip duration in ms — used to scale per-frame motion into
   *  per-second velocities. When omitted, defaults to 3000 ms (typical
   *  recorded swing length). */
  clipDurationMs?: number | null;
  /** Selected club for this swing — drives the profile-distance
   *  lookup and the typical-smash defaults. */
  club?: string | null;
  /** Player profile snapshot — read at compose time so the service
   *  doesn't have to import a store. */
  profile?: {
    handicap?: number | null;
    clubDistances?: Record<string, number> | null;
  };
  /** Measured ball speed from acoustic / radar / launch monitor
   *  (mph). When present, used directly. */
  measuredBallSpeedMph?: number | null;
  /** Measured club speed from Galaxy Watch IMU or similar (mph).
   *  When present, used directly. */
  measuredClubSpeedMph?: number | null;
}

// ─── Defaults ────────────────────────────────────────────────────────

/** Tour-standard smash factor by club category. Used as the
 *  fallback when we have one of {club_speed, ball_speed} but not
 *  both, OR to back-derive the missing one from the present one
 *  via smash × club_speed. */
const TYPICAL_SMASH_BY_CLUB: Record<string, number> = {
  driver: 1.48,
  '3w':   1.46,
  '5w':   1.44,
  hybrid: 1.42,
  '4i':   1.40,
  '5i':   1.39,
  '6i':   1.38,
  '7i':   1.37,
  '8i':   1.36,
  '9i':   1.35,
  pw:     1.33,
  gw:     1.30,
  sw:     1.25,
  lw:     1.20,
  unknown: 1.36,
};

/** Handicap-keyed default club speeds (mph) — used as last-resort
 *  fallback when neither measurement nor pose nor profile data is
 *  available. Calibrated to USGA averages: scratch ~108 driver, mid-
 *  handicap ~95, high-handicap ~85. */
function defaultClubSpeedFromHandicap(club: string, handicap: number | null): number {
  const base = handicap == null ? 95 : Math.max(70, 108 - Math.min(handicap, 36) * 0.6);
  const clubFactor: Record<string, number> = {
    driver: 1.00, '3w': 0.93, '5w': 0.88, hybrid: 0.84,
    '4i': 0.81, '5i': 0.78, '6i': 0.75, '7i': 0.72,
    '8i': 0.69, '9i': 0.66, pw: 0.62, gw: 0.58,
    sw: 0.55, lw: 0.52,
  };
  const factor = clubFactor[normalizeClub(club)] ?? 0.72; // default ~7i
  return Math.round(base * factor);
}

function normalizeClub(c: string | null | undefined): string {
  if (!c) return 'unknown';
  const lc = c.toLowerCase().replace(/\s+/g, '');
  if (lc.includes('driver') || lc === '1w') return 'driver';
  if (lc === '3w' || lc.includes('3wood')) return '3w';
  if (lc === '5w' || lc.includes('5wood')) return '5w';
  if (lc.includes('hybrid') || lc.match(/^[3-7]h$/)) return 'hybrid';
  const ironMatch = lc.match(/^(\d)i(ron)?$/) || lc.match(/^(\d)(iron)?$/);
  if (ironMatch) return `${ironMatch[1]}i`;
  if (lc === 'pw' || lc.includes('pitching')) return 'pw';
  if (lc === 'gw' || lc === 'aw' || lc.includes('approach') || lc.includes('gap')) return 'gw';
  if (lc === 'sw' || lc.includes('sand')) return 'sw';
  if (lc === 'lw' || lc.includes('lob')) return 'lw';
  return 'unknown';
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Synthesize a SwingMetricSet from whatever inputs the caller has.
 * Returns a fully-populated object — every field is non-null SwingMetric
 * but `value` may be null when no source could produce a number.
 *
 * Layered fallback per metric:
 *   measured > pose_estimated > profile_estimated > placeholder
 */
export function synthesizeSwingMetrics(inputs: SwingMetricInputs): SwingMetricSet {
  const clubKey = normalizeClub(inputs.club);
  const handicap = inputs.profile?.handicap ?? null;
  const profileCarry = clubKey !== 'unknown'
    ? inputs.profile?.clubDistances?.[clubKey] ?? null
    : null;

  // ── Club speed ──
  // 2026-05-24 — Per spec ("Lead with what's real"): club head speed
  // is the hardest metric from 2D video. Ceiling pose-derived
  // confidence at 'med' (0.45-0.55); never claim 'high' without a
  // measured signal. Out-of-band raw values get forced to 'low' inside
  // clubSpeedFromPose; extreme values return null (no number rendered).
  let clubSpeed: SwingMetric;
  if (typeof inputs.measuredClubSpeedMph === 'number' && Number.isFinite(inputs.measuredClubSpeedMph)) {
    clubSpeed = finalize({
      value: Math.round(inputs.measuredClubSpeedMph),
      unit: 'mph',
      source: 'measured',
      confidence: 0.95,
      estimateNote: undefined, // measured — no methodology label needed
    });
  } else {
    const fromPose = clubSpeedFromPose(inputs.poseFrames, inputs.clipDurationMs);
    if (fromPose != null) {
      clubSpeed = finalize({
        value: Math.round(fromPose.value),
        unit: 'mph',
        source: 'pose_estimated',
        confidence: fromPose.confidence,
        estimateNote: fromPose.outOfBand
          ? 'pose heuristic, out-of-band'
          : 'pose heuristic',
      });
    } else {
      const fromProfile = defaultClubSpeedFromHandicap(clubKey, handicap);
      clubSpeed = finalize({
        value: fromProfile,
        unit: 'mph',
        source: handicap != null ? 'profile_estimated' : 'placeholder',
        confidence: handicap != null ? 0.40 : 0.20, // profile speeds never reach 'med'
        estimateNote: handicap != null ? 'handicap default' : 'placeholder',
      });
    }
  }

  // ── Ball speed ──
  // Derived: club_speed × typical_smash[club]. Honest tag: when the
  // parent (club_speed) is itself an estimate, the derivation is
  // tautological — the smash ratio is implicit so the resulting
  // "ball speed" carries the same uncertainty as club speed × a
  // club-typical multiplier. Confidence inherits the parent and
  // ceilings at 'med'.
  let ballSpeed: SwingMetric;
  if (typeof inputs.measuredBallSpeedMph === 'number' && Number.isFinite(inputs.measuredBallSpeedMph)) {
    ballSpeed = finalize({
      value: Math.round(inputs.measuredBallSpeedMph),
      unit: 'mph',
      source: 'measured',
      confidence: 0.92,
      estimateNote: undefined,
    });
  } else if (clubSpeed.value != null) {
    const typicalSmash = TYPICAL_SMASH_BY_CLUB[clubKey] ?? TYPICAL_SMASH_BY_CLUB.unknown;
    ballSpeed = finalize({
      value: Math.round(clubSpeed.value * typicalSmash),
      unit: 'mph',
      // Mirror parent source — measured club speed times typical smash
      // is still pose_estimated for downstream consumers (the ratio is
      // assumed, not measured).
      source: clubSpeed.source === 'measured' ? 'pose_estimated' : clubSpeed.source,
      confidence: Math.min(clubSpeed.confidence, 0.45),
      estimateNote: 'club speed × typical smash for ' + clubKey,
    });
  } else {
    ballSpeed = nullMetric('mph');
  }

  // ── Smash factor ──
  // Compounding gate (spec change 4): smash is ball/club; if EITHER
  // parent is low confidence the ratio is just noise — suppress the
  // hard number entirely. When both are at least 'med', render with
  // confidence = worst-of-parents.
  let smashFactor: SwingMetric;
  if (clubSpeed.value != null && ballSpeed.value != null && clubSpeed.value > 0) {
    const bothMeasured = clubSpeed.source === 'measured' && ballSpeed.source === 'measured';
    const eitherLow = bucketize(clubSpeed.confidence) === 'low' || bucketize(ballSpeed.confidence) === 'low';
    if (bothMeasured) {
      const ratio = ballSpeed.value / clubSpeed.value;
      smashFactor = finalize({
        value: Math.round(ratio * 100) / 100,
        unit: '',
        source: 'measured',
        confidence: 0.95,
        estimateNote: undefined,
      });
    } else if (eitherLow) {
      // Suppress — any value here would mislead the user.
      smashFactor = nullMetric('');
    } else {
      const ratio = ballSpeed.value / clubSpeed.value;
      smashFactor = finalize({
        value: Math.round(ratio * 100) / 100,
        unit: '',
        source: 'pose_estimated',
        confidence: Math.min(clubSpeed.confidence, ballSpeed.confidence) * 0.7,
        estimateNote: 'compounded — inherits both estimates',
      });
    }
  } else {
    smashFactor = nullMetric('');
  }

  // ── Carry yards ──
  // Profile carry wins when populated (player's own typical for this
  // club is the most honest number). Otherwise derive from ball speed
  // — and gate: if ball speed is low, carry is low too (compounds).
  let carryYards: SwingMetric;
  if (profileCarry != null) {
    carryYards = finalize({
      value: profileCarry,
      unit: 'yds',
      source: 'profile_estimated',
      confidence: 0.60,
      estimateNote: 'your typical for this club',
    });
  } else if (ballSpeed.value != null) {
    const ballLow = bucketize(ballSpeed.confidence) === 'low';
    if (ballLow) {
      // Compounding gate: derivative of a low parent is also low.
      // Suppress the value rather than render a confident wrong yardage.
      carryYards = nullMetric('yds');
    } else {
      const factor = ['driver', '3w', '5w', 'hybrid'].includes(clubKey) ? 1.65 : 1.4;
      carryYards = finalize({
        value: Math.round(ballSpeed.value * factor),
        unit: 'yds',
        source: ballSpeed.source === 'measured' ? 'pose_estimated' : ballSpeed.source,
        confidence: Math.min(ballSpeed.confidence, 0.35),
        estimateNote: 'ball speed × tour-avg factor',
      });
    }
  } else {
    carryYards = nullMetric('yds');
  }

  devLog(
    `[swingMetrics] club=${clubKey} ` +
    `speed=${clubSpeed.value}mph(${clubSpeed.source}/${clubSpeed.confidenceLabel}) ` +
    `ball=${ballSpeed.value}mph(${ballSpeed.source}/${ballSpeed.confidenceLabel}) ` +
    `smash=${smashFactor.value}(${smashFactor.source}/${smashFactor.confidenceLabel}) ` +
    `carry=${carryYards.value}y(${carryYards.source}/${carryYards.confidenceLabel})`,
  );

  return {
    club_speed: clubSpeed,
    ball_speed: ballSpeed,
    smash_factor: smashFactor,
    carry_yards: carryYards,
  };
}

// 2026-05-24 — Finalize a partially-built metric by deriving the
// discrete confidenceLabel and range from the continuous confidence +
// source. Single chokepoint so every metric flows through the same
// honest-presentation shape — Metrics 1B (acoustic ball speed) and 2
// (calibration) just set source / confidence and inherit the rest.
function finalize(partial: {
  value: number | null;
  unit: string;
  source: MetricSource;
  confidence: number;
  estimateNote?: string;
}): SwingMetric {
  const label = bucketize(partial.confidence);
  const range = rangeFor(partial.value, partial.source, label, partial.unit);
  return {
    value: partial.value,
    unit: partial.unit,
    source: partial.source,
    confidence: partial.confidence,
    confidenceLabel: label,
    range,
    estimateNote: partial.estimateNote,
  };
}

function nullMetric(unit: string): SwingMetric {
  return {
    value: null,
    unit,
    source: 'placeholder',
    confidence: 0,
    confidenceLabel: 'low',
    range: null,
  };
}

/**
 * Pose-derived club speed estimate. Reads peak wrist velocity around
 * the P6 impact frame in the pose stream.
 *
 * 2026-05-24 (Metrics 1A) — Killed the silent [45, 130] clamp. The
 * clamp coerced every reading into a plausible-looking number, which
 * meant a degenerate input (camera at the floor, partial view, glasses
 * POV, blur) still rendered "Club Speed: 95 mph · pose" with no caller
 * visible signal that the underlying number was junk.
 *
 * New behavior:
 *   - Compute the raw mph honestly
 *   - When mph falls extremely outside swing range [25, 180] → return
 *     null (degenerate — never present a number)
 *   - When mph falls outside plausible [45, 130] but inside the
 *     extreme bounds → return the raw value with `outOfBand: true`
 *     so caller can force confidence to 'low' and widen the range
 *   - Confidence ceiling lowered from 0.70 → 0.55 (pose-derived
 *     metrics should never reach the 'high' bucket reserved for
 *     measured signals)
 *
 * Returns null when:
 *   - Fewer than 3 pose frames present (no velocity baseline)
 *   - Wrist keypoints missing or low-confidence at impact
 *   - Clip duration unknown / implausible
 *   - Raw mph is extremely out of any conceivable swing range
 *
 * Math: peak inter-frame wrist displacement in normalized image
 * coordinates × empirical conversion constant. Heuristic ±15-25%
 * error band on typical full-body down-the-line clips; significantly
 * worse on partial-view / cropped / glasses-POV frames (which is
 * exactly when the out-of-band path now fires).
 */
function clubSpeedFromPose(
  frames: PoseFrame[] | null | undefined,
  clipDurationMs: number | null | undefined,
): { value: number; confidence: number; outOfBand: boolean } | null {
  if (!frames || frames.length < 3) return null;
  // Duration sanity: < 200ms or > 12s is implausible for a real swing
  // clip; bail rather than scale by an absurd factor.
  if (clipDurationMs != null && (clipDurationMs <= 200 || clipDurationMs > 12_000)) {
    devLog(`[swingMetrics] club_speed: bad duration ${clipDurationMs}ms → null`);
    return null;
  }
  const duration = clipDurationMs && clipDurationMs > 200 ? clipDurationMs : 3000;
  // Track lead wrist (left for right-handed; mirroring handled
  // upstream in poseEstimator.adjustKeypoint when lefty).
  const wrists: Array<{ x: number; y: number; t: number; score: number }> = [];
  for (const f of frames) {
    const lw = f.keypoints.find((k) => k.name === 'left_wrist');
    if (lw && lw.score >= 0.3) {
      wrists.push({ x: lw.x, y: lw.y, t: f.timestampMs, score: lw.score });
    }
  }
  if (wrists.length < 3) return null;
  // Compute frame-to-frame velocity; return the peak.
  let peakVelocity = 0;
  let avgScore = 0;
  for (let i = 1; i < wrists.length; i++) {
    const dx = wrists[i].x - wrists[i - 1].x;
    const dy = wrists[i].y - wrists[i - 1].y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const dt = Math.max(1, wrists[i].t - wrists[i - 1].t);
    const v = dist / dt; // normalized units per ms
    if (v > peakVelocity) peakVelocity = v;
    avgScore += wrists[i].score;
  }
  avgScore /= wrists.length;
  if (peakVelocity === 0) return null;
  // Conversion: normalized image units → real-world m/s.
  // Empirical constant ~150 m/s per normalized-unit-per-ms for a
  // typical full-body downswing capture at ~3s total clip length.
  // Then m/s → mph: × 2.237.
  const mph = peakVelocity * 150 * 2.237 * (3000 / duration);

  // Hard implausible: nothing in this range is a real golf swing.
  // Return null rather than fake a number — caller falls back to
  // profile-derived value (handicap defaults) which is at least
  // honestly labeled.
  if (mph < 25 || mph > 180) {
    devLog(`[swingMetrics] club_speed: extreme out-of-band ${mph.toFixed(1)}mph → null`);
    return null;
  }

  // Borderline implausible: 25-44 or 131-180 mph. Still a swing-shaped
  // motion but the heuristic almost certainly read something wrong
  // (camera angle off, partial view, blur smearing wrist position).
  // Surface the raw value but flag outOfBand so caller forces low
  // confidence + widens the range — no silent clamp.
  const outOfBand = mph < 45 || mph > 130;

  let confidence = Math.min(0.55, avgScore * (wrists.length >= 5 ? 1 : 0.8));
  if (outOfBand) confidence = Math.min(confidence, 0.30);

  return { value: mph, confidence, outOfBand };
}
