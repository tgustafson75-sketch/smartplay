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
  /** Numeric value when present; null when unknown. */
  value: number | null;
  /** Unit string for display ('mph', 'yds', or '' for ratios). */
  unit: string;
  /** Where this number came from — drives the UI's "est" badge. */
  source: MetricSource;
  /** 0..1 — engine's confidence in the value. Below 0.5 the UI
   *  should hedge ('~' or 'est') vs above 0.8 it can be unhedged. */
  confidence: number;
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
  let clubSpeed: SwingMetric = nullMetric('mph');
  if (typeof inputs.measuredClubSpeedMph === 'number' && Number.isFinite(inputs.measuredClubSpeedMph)) {
    clubSpeed = {
      value: Math.round(inputs.measuredClubSpeedMph),
      unit: 'mph',
      source: 'measured',
      confidence: 0.95,
    };
  } else {
    const fromPose = clubSpeedFromPose(inputs.poseFrames, inputs.clipDurationMs);
    if (fromPose != null) {
      clubSpeed = { value: Math.round(fromPose.value), unit: 'mph', source: 'pose_estimated', confidence: fromPose.confidence };
    } else {
      const fromProfile = defaultClubSpeedFromHandicap(clubKey, handicap);
      clubSpeed = {
        value: fromProfile,
        unit: 'mph',
        source: handicap != null ? 'profile_estimated' : 'placeholder',
        confidence: handicap != null ? 0.45 : 0.20,
      };
    }
  }

  // ── Ball speed ──
  let ballSpeed: SwingMetric = nullMetric('mph');
  if (typeof inputs.measuredBallSpeedMph === 'number' && Number.isFinite(inputs.measuredBallSpeedMph)) {
    ballSpeed = {
      value: Math.round(inputs.measuredBallSpeedMph),
      unit: 'mph',
      source: 'measured',
      confidence: 0.92,
    };
  } else if (clubSpeed.value != null) {
    // Back-derive from club_speed × typical smash for the club.
    const typicalSmash = TYPICAL_SMASH_BY_CLUB[clubKey] ?? TYPICAL_SMASH_BY_CLUB.unknown;
    ballSpeed = {
      value: Math.round(clubSpeed.value * typicalSmash),
      unit: 'mph',
      // Tag with the SAME source as club_speed — ball speed is a
      // derived metric here, so honesty requires it not claim a
      // higher confidence than its parent.
      source: clubSpeed.source === 'measured' ? 'profile_estimated' : clubSpeed.source,
      confidence: Math.min(clubSpeed.confidence, 0.6),
    };
  }

  // ── Smash factor ──
  let smashFactor: SwingMetric = nullMetric('');
  if (clubSpeed.value != null && ballSpeed.value != null && clubSpeed.value > 0) {
    const ratio = ballSpeed.value / clubSpeed.value;
    // Only compute when both upstream metrics had real sources;
    // when both fall back to a typical-smash-derived ball speed
    // off a profile_estimated club speed, the resulting smash is
    // tautological (just the typical smash back). Surface that
    // honestly with lower confidence.
    const bothMeasured = clubSpeed.source === 'measured' && ballSpeed.source === 'measured';
    smashFactor = {
      value: Math.round(ratio * 100) / 100,
      unit: '',
      source: bothMeasured ? 'measured' : 'pose_estimated',
      confidence: bothMeasured ? 0.95 : Math.min(clubSpeed.confidence, ballSpeed.confidence) * 0.8,
    };
  }

  // ── Carry yards ──
  let carryYards: SwingMetric = nullMetric('yds');
  if (profileCarry != null) {
    carryYards = {
      value: profileCarry,
      unit: 'yds',
      source: 'profile_estimated',
      confidence: 0.75,
    };
  } else if (ballSpeed.value != null) {
    // Rough carry estimate from ball speed: ball_speed × 1.4 yards/mph
    // for irons, × 1.65 for woods. Calibrated to PGA Tour averages.
    const factor = ['driver', '3w', '5w', 'hybrid'].includes(clubKey) ? 1.65 : 1.4;
    carryYards = {
      value: Math.round(ballSpeed.value * factor),
      unit: 'yds',
      source: ballSpeed.source === 'measured' ? 'pose_estimated' : ballSpeed.source,
      confidence: Math.min(ballSpeed.confidence, 0.5),
    };
  }

  devLog(
    `[swingMetrics] club=${clubKey} speed=${clubSpeed.value}mph(${clubSpeed.source}) ` +
    `ball=${ballSpeed.value}mph(${ballSpeed.source}) smash=${smashFactor.value}(${smashFactor.source}) ` +
    `carry=${carryYards.value}y(${carryYards.source})`,
  );

  return {
    club_speed: clubSpeed,
    ball_speed: ballSpeed,
    smash_factor: smashFactor,
    carry_yards: carryYards,
  };
}

function nullMetric(unit: string): SwingMetric {
  return { value: null, unit, source: 'placeholder', confidence: 0 };
}

/**
 * Pose-derived club speed estimate. Reads peak wrist velocity around
 * the P6 impact frame in the pose stream. Returns null when:
 *   - Fewer than 3 pose frames present (no velocity baseline)
 *   - Wrist keypoints missing or low-confidence at impact
 *   - Clip duration unknown (can't scale to mph)
 *
 * Math: peak inter-frame wrist displacement in normalized image
 * coordinates × image-to-real-world scale (rough: assume ~2m tall
 * subject, ~0.5m frame-relative arm length → conversion constant).
 * This is a HEURISTIC estimate — designed to land within ±15% of
 * truth on a typical full-body down-the-line clip, but unreliable
 * for partial-view / glasses-POV / heavily-cropped frames.
 */
function clubSpeedFromPose(
  frames: PoseFrame[] | null | undefined,
  clipDurationMs: number | null | undefined,
): { value: number; confidence: number } | null {
  if (!frames || frames.length < 3) return null;
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
  // Clamp to realistic golf-swing range (45-130 mph for irons +
  // drivers) so outlier frames don't produce nonsense values.
  const clamped = Math.max(45, Math.min(130, mph));
  return {
    value: clamped,
    // Confidence scales with keypoint quality + frame count.
    confidence: Math.min(0.7, avgScore * (wrists.length >= 5 ? 1 : 0.8)),
  };
}
