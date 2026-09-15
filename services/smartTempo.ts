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

/**
 * 2026-06-24 (Tim — mode-aware tempo) — the Smart Motion state a tempo read
 * was captured in.
 *
 *   • 'full_swing' — DOWN-THE-LINE and FACE-ON. They are the SAME full swing:
 *     same tour 3:1 target, same detection (pose "hands-highest = top" + the
 *     acoustic strike work in both camera views). ONE shared profile — we do
 *     NOT invent a different ratio for face-on.
 *   • 'putt' — the genuinely different one. A smoother, more EVEN stroke
 *     (~2:1 back:through, not 3:1), SHORT (sub-second), and QUIET — there is
 *     no loud acoustic strike, so impact CANNOT come from the acoustic
 *     detector. Its own profile: a looser ~2:1 target + impact derived from
 *     POSE MOTION (the forward-stroke pass through the ball), defaulted to
 *     LOWER confidence because the small/quiet motion is harder to read.
 */
export type TempoMode = 'full_swing' | 'putt';

/** The three real timestamps a tempo read is built from, in SECONDS
 *  relative to the same clock (clip start). Must satisfy
 *  backswingStartSec < topSec < impactSec.
 *
 *  Naming note: for a PUTT these are the analogous stroke phases —
 *  backswingStart = stroke takeaway, top = end of backstroke (reversal),
 *  impact = the forward-stroke pass through the ball. */
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
  /** The mode this read was graded as. Defaults to 'full_swing'. */
  mode: TempoMode;
  /** The target this read is graded against — 3 for a full swing, 2 for a
   *  putt. A NUMBER (not the literal 3) so the patch / metronome can draw the
   *  right ideal for either mode. */
  targetRatio: number;
  /** Short, honest target framing, e.g. "tour 3:1" or "putt ~2:1 (smooth & even)". */
  targetLabel: string;
}

// ─── Tempo profiles (per mode) ─────────────────────────────────────────
//
// FULL SWING — graded against the tour-standard 3:1 (backswing is ~3x the
// downswing). Byte-identical to the v2 single-mode behavior.
//
//   ratio < 2.7          → 'rushed'   (downswing too quick vs the backswing
//                                       — the common amateur fault)
//   2.7 ≤ ratio ≤ 3.3    → 'on_tempo' (right in the tour band)
//   3.3 < ratio < 3.6    → 'smooth'   (a touch long but still fluid)
//   ratio ≥ 3.6          → 'slow'     (load is long / downswing too slow)
//
// 'smooth' is the honest band just above on-tempo: the load is slightly long
// but the transition is still unhurried (a forgivable, often-deliberate
// pattern) — distinct from a genuinely 'slow' tempo where the downswing lags.
//
// 2026-09-14 (Tim — "triple check tempo analysis, I have a feeling it is still giving generic
// reads") — smoothHigh WAS 3.4, making this band 0.10 ratio-units wide against on_tempo's 0.61 and
// the putt profile's 0.39. A four-state scale with one state you essentially cannot land in is a
// three-state scale, and every slightly-long load was told its downswing was "lagging". 3.6 restores
// the proportion the putt profile already had — and it is the same upper bound
// services/swing/poseSwingRead had been using all along, so the two now agree instead of
// contradicting each other on the same swing.
//
// PUTT — a smoother, more EVEN stroke. We grade against a ~2:1 GUIDE (the
// backstroke a touch longer than the through-stroke), NOT a precise tour
// standard — there isn't one. So the bands are LOOSER and the language leans
// on SMOOTH + EVEN rhythm over hitting a number. Honest by design.
//
//   ratio < 1.7          → 'rushed'   (forward stroke jabbed / decelerated load)
//   1.7 ≤ ratio ≤ 2.3    → 'on_tempo' (smooth, even — right in the guide)
//   2.3 < ratio < 2.7    → 'smooth'   (backstroke a hair long, still fluid)
//   ratio ≥ 2.7          → 'slow'     (long backstroke / sluggish forward pass)
interface TempoBand {
  onTempoLow: number;
  onTempoHigh: number;
  smoothHigh: number;
}

/**
 * Three stems per rating, by HOW FAR OFF the read is. Not three ways of saying one thing — the
 * advice genuinely differs: "you are close, let it finish" and "the downswing starts before the
 * backswing does" are different faults with different fixes, and the old single string said
 * "slightly" to both. The measured numbers are composed in front of whichever stem applies.
 */
interface TempoCue { near: string; mid: string; far: string }

interface TempoProfile {
  targetRatio: number;
  targetLabel: string;
  band: TempoBand;
  meta: Record<TempoRating, { label: string; cue: TempoCue }>;
}

const TEMPO_PROFILES: Record<TempoMode, TempoProfile> = {
  full_swing: {
    targetRatio: 3,
    targetLabel: 'tour 3:1',
    band: { onTempoLow: 2.7, onTempoHigh: 3.3, smoothHigh: 3.6 },
    meta: {
      rushed: {
        label: 'Rushed',
        cue: {
          near: 'Let the club finish the backswing before you fire — you are close.',
          mid: 'Slow the load and let the club finish before you fire.',
          far: 'The downswing is starting before the backswing has finished. That is a rhythm change, not a tweak — count the load out.',
        },
      },
      on_tempo: {
        label: 'On Tempo',
        cue: { near: 'Right on tempo — repeat it.', mid: 'Right on tempo — repeat it.', far: 'Right on tempo — repeat it.' },
      },
      smooth: {
        label: 'Smooth',
        cue: {
          near: 'Unhurried and clean — a hair long on the load, nothing to fix.',
          mid: 'Smooth and unhurried — the load runs a little long, but the transition is clean.',
          far: 'Smooth, but the load is getting long. Keep the transition and shorten the backswing a touch.',
        },
      },
      slow: {
        /**
         * These described a LAGGING DOWNSWING, which is a LOW ratio — the opposite band. A high
         * ratio is a long, slow LOAD with a normal strike, so that is what they say now.
         */
        label: 'Slow',
        cue: {
          near: 'The load runs slightly long — start down a fraction sooner.',
          mid: 'Your backswing is long for the speed you come down at — shorten the load and start down as it finishes.',
          far: 'The load is far longer than the strike it produces — the club is waiting at the top. Shorten the backswing and start down as it finishes.',
        },
      },
    },
  },
  putt: {
    targetRatio: 2,
    targetLabel: 'putt ~2:1 (smooth & even)',
    band: { onTempoLow: 1.7, onTempoHigh: 2.3, smoothHigh: 2.7 },
    meta: {
      rushed: {
        label: 'Quick Through',
        cue: {
          near: 'The forward stroke is a shade ahead — even it up with the backstroke.',
          mid: 'Your forward stroke is jumping ahead — match the backstroke with a smooth, even pass through the ball.',
          far: 'You are jabbing at it: the forward stroke is far quicker than the backstroke. Let the backstroke set the pace.',
        },
      },
      on_tempo: {
        label: 'Smooth & Even',
        cue: {
          near: 'Smooth, even putting rhythm — backstroke and forward stroke in balance. Repeat it.',
          mid: 'Smooth, even putting rhythm — backstroke and forward stroke in balance. Repeat it.',
          far: 'Smooth, even putting rhythm — backstroke and forward stroke in balance. Repeat it.',
        },
      },
      smooth: {
        label: 'Smooth',
        cue: {
          near: 'Nicely unhurried — a touch long on the backstroke, but the stroke stays smooth.',
          mid: 'Nicely unhurried — a touch long on the backstroke, but the stroke stays smooth.',
          far: 'Unhurried, but the backstroke is getting long — shorten it and keep the same pace.',
        },
      },
      slow: {
        label: 'Long Back',
        cue: {
          near: 'The backstroke is running a little long — shorten it so the through-stroke keeps accelerating.',
          mid: 'Your backstroke is running long — shorten it so the through-stroke can stay even and accelerating.',
          far: 'The backstroke is far longer than the pass through the ball, which is how a putt gets decelerated. Shorten the load.',
        },
      },
    },
  },
};

function profileFor(mode: TempoMode): TempoProfile {
  return TEMPO_PROFILES[mode] ?? TEMPO_PROFILES.full_swing;
}

function ratingFor(ratio: number, band: TempoBand): TempoRating {
  if (ratio < band.onTempoLow) return 'rushed';
  if (ratio <= band.onTempoHigh) return 'on_tempo';
  if (ratio < band.smoothHigh) return 'smooth';
  return 'slow';
}

/**
 * How far outside the band the read sits, in ratio units. 0 when inside it.
 *
 * This is the number that makes the difference between a 2.6:1 and a 1.2:1 sayable. Both were
 * 'rushed', both got the identical sentence, and that sentence said "slightly" — which is sound
 * advice for one of them and actively wrong for the other.
 */
function distanceOutsideBand(ratio: number, band: TempoBand): number {
  if (ratio < band.onTempoLow) return band.onTempoLow - ratio;
  if (ratio > band.smoothHigh) return ratio - band.smoothHigh;
  if (ratio > band.onTempoHigh) return ratio - band.onTempoHigh;   // inside 'smooth'
  return 0;
}

/** Severity stem to use. Thresholds are in ratio units and deliberately coarse. */
function severityFor(distance: number): keyof TempoCue {
  if (distance < 0.25) return 'near';
  if (distance < 0.75) return 'mid';
  return 'far';
}

const ms = (n: number) => `${Math.round(n)} ms`;

/**
 * THE COACHING LINE, COMPOSED FROM THE MEASUREMENT.
 *
 * 2026-09-14 (Tim — "triple check tempo analysis. I have a feeling it is still giving generic
 * reads.") He was right, and it was generic BY CONSTRUCTION: `coaching` was one of four fixed
 * strings per mode, selected by rating and nothing else. Every rushed swing any player ever made
 * — 1.0:1 or 2.6:1 — got the same sentence, and the ratio the engine had just measured to the
 * millisecond appeared nowhere in it.
 *
 * So the line is built: the two real durations, what the downswing WOULD be at the target while
 * holding his own backswing, the gap between them, and a cue graded by how far off he actually is.
 * Every number in it is measured or derived from a measured number — nothing is asserted about a
 * player the engine cannot see. [[illustration-data-points]]
 */
function composeCoaching(
  backswingMs: number,
  downswingMs: number,
  /**
   * The ROUNDED ratio — the same value `rating` was derived from and the same one the card shows.
   * Passing the raw ratio here would put the severity and the rating on different numbers, so at a
   * band edge a read could be graded 'on_tempo' while its severity said it was outside.
   */
  shownRatio: number,
  rating: TempoRating,
  profile: TempoProfile,
  recentAvgRatio?: number | null,
): string {
  const distance = distanceOutsideBand(shownRatio, profile.band);
  const stem = profile.meta[rating].cue[severityFor(distance)];
  const facts = `Backswing ${ms(backswingMs)}, downswing ${ms(downswingMs)}.`;

  /**
   * THE COUNTERFACTUAL HOLDS THE DOWNSWING AND SOLVES FOR THE LOAD. Always, in both directions.
   *
   * Two wrong versions preceded this one, and the second exposed a third problem that was not mine.
   *
   * v1 held the BACKSWING and solved for the downswing. On a rushed swing that inverts the advice:
   * 1.2:1 is backswing 300 ms / downswing 250 ms, and at 3:1 with the load held the downswing
   * "should" be 100 ms — so it told a player whose transition was far too quick that he was
   * "150 ms slow through it", and prescribed a downswing no human makes.
   *
   * v2 split by direction, and on the slow side produced nothing at all: 4.6:1 is backswing 1150 /
   * downswing 250, where the downswing is already FASTER than 3:1 would want. Which is the real
   * point — a high ratio is not a lagging downswing, it is a long load. The 'slow' coaching line
   * had been saying "your downswing is lagging the load" since the file was written, and that
   * describes a LOW ratio. It was wrong about its own band.
   *
   * Holding the downswing is also how the domain actually works: Tour Tempo's frame counts (24/8,
   * 21/7, 27/9 at 30 fps) all keep the DOWNSWING at eight frames — roughly a quarter second for
   * everyone — and vary the backswing. So the load is both the honest variable and the actionable
   * one, whichever side of the band he is on.
   */
  let gap = '';
  if (rating !== 'on_tempo') {
    const idealBack = downswingMs * profile.targetRatio;
    const delta = Math.round(idealBack - backswingMs);
    if (Math.abs(delta) >= 10) {
      gap = ` Against that downswing, ${profile.targetLabel.replace(/^tour /, '')} would want a `
        + `${ms(idealBack)} backswing — your load is ${Math.abs(delta)} ms ${delta > 0 ? 'short' : 'long'}.`;
    }
  }

  /**
   * HIS OWN BASELINE, when there is one. A tour band says whether he is a tour player; his own
   * recent average says whether this swing was him. Only stated when it differs enough to mean
   * something — a 0.1 wobble between reads is noise in a pose-derived phase, not a change.
   */
  let mine = '';
  if (typeof recentAvgRatio === 'number' && Number.isFinite(recentAvgRatio) && recentAvgRatio > 0) {
    const d = shownRatio - recentAvgRatio;
    mine = Math.abs(d) < 0.2
      ? ` That is your normal — you average ${recentAvgRatio.toFixed(1)}:1.`
      : ` ${d > 0 ? 'Slower' : 'Quicker'} than your usual ${recentAvgRatio.toFixed(1)}:1.`;
  }

  return `${facts}${gap}${mine} ${stem}`;
}

/**
 * Pure tempo computation from three real phase timestamps. Returns null
 * when the ordering is invalid (start < top < impact must hold) or any
 * phase duration is ≤ 0 — we never fabricate a ratio from a bad read.
 *
 * `mode` selects the profile (target ratio + rating bands + coaching). It
 * defaults to 'full_swing' so every existing caller is byte-identical.
 */
export function computeTempo(
  phases: TempoPhases,
  mode: TempoMode = 'full_swing',
  /**
   * His own recent average ratio, when the caller has one. Optional and omitted by default, so every
   * existing call site is unchanged and no surface is forced to invent a baseline it does not have.
   */
  recentAvgRatio?: number | null,
): TempoResult | null {
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

  const profile = profileFor(mode);
  /**
   * GRADED ON THE NUMBER HE IS SHOWN.
   *
   * 2026-09-14 — the rating was computed from the full-precision ratio while the card displays
   * `ratio.toFixed(1)`, so the two disagreed at every band edge: 3.35 and 3.44 both render as
   * "3.4:1" and fell on opposite sides of a boundary. Two swings, the same number on screen, two
   * different verdicts and two different coaching lines, with nothing visible to explain it. Round
   * first, then grade, and the number he can see is the number he was judged on.
   * [[state-what-you-measured-not-what-you-intended]]
   */
  const shownRatio = Math.round(ratio * 10) / 10;
  const rating = ratingFor(shownRatio, profile.band);
  const meta = profile.meta[rating];

  return {
    backswingMs: Math.round(backswingMs),
    downswingMs: Math.round(downswingMs),
    ratio,
    ratioLabel: `${shownRatio.toFixed(1)}:1`,
    rating,
    ratingLabel: meta.label,
    coaching: composeCoaching(backswingMs, downswingMs, shownRatio, rating, profile, recentAvgRatio),
    mode,
    targetRatio: profile.targetRatio,
    targetLabel: profile.targetLabel,
  };
}

/**
 * The band edges for a mode, so no other surface has to declare its own idea of "good tempo".
 *
 * 2026-09-14 — `services/swing/poseSwingRead` held a SECOND set (on-tempo 2.6–3.6, strength
 * 2.8–3.4) and the two disagreed on real swings: a 2.65:1 was "Rushed" on the Smart Tempo card and
 * "right in the tour range" on the SmartMotion read; a 3.5:1 was "Slow" on one and "solid" on the
 * other. Same swing, same app, opposite verdicts depending on which screen you opened.
 * [[two-owners-is-the-root-cause]]
 */
export function tempoBandFor(mode: TempoMode = 'full_swing'): Readonly<TempoBand & { targetRatio: number }> {
  const p = profileFor(mode);
  return { ...p.band, targetRatio: p.targetRatio };
}

/** The rating a ratio earns, for a caller that has a ratio but no phase timestamps. */
export function tempoRatingFor(ratio: number, mode: TempoMode = 'full_swing'): TempoRating | null {
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  return ratingFor(Math.round(ratio * 10) / 10, profileFor(mode).band);
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
   *  'none'    — nothing derivable; phases is empty.
   *
   * NOTE (putt honesty): a PUTT read NEVER returns 'auto'. Pose-only putt
   * detection — small, quiet, sub-second motion with no acoustic anchor — is
   * genuinely less reliable than a full swing, so even when all three phases
   * come out we cap a putt at 'partial' to push the user through the
   * scrub/refine flow rather than over-claiming an exact stroke ratio. */
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
 *
 * `mode` (default 'full_swing') changes how IMPACT is found and how
 * confident we allow ourselves to be:
 *   • 'full_swing' — IMPACT from the acoustic strike (most reliable),
 *     TOP/START from pose. Unchanged from v2.
 *   • 'putt' — there is NO loud strike, so the acoustic impact is IGNORED
 *     (it won't fire / isn't reliable for a quiet putt). IMPACT is derived
 *     from POSE MOTION: the forward-stroke pass back through address height
 *     (the lead-hand direction reversal toward the ball after the top).
 *     TOP/START come from the same wrist-y series. A putt read is capped at
 *     'partial' confidence (see DetectTempoOutput) so the UI always invites a
 *     scrub/refine — we never fabricate a putt impact or over-claim a ratio.
 */
export function detectTempoPhases(input: DetectTempoInput, mode: TempoMode = 'full_swing'): DetectTempoOutput {
  try {
    const isPutt = mode === 'putt';
    const phases: Partial<TempoPhases> = {};
    const clipStartMs = typeof input.clipStartMs === 'number' && Number.isFinite(input.clipStartMs)
      ? input.clipStartMs
      : 0;

    // ── 1. Impact ───────────────────────────────────────────────────
    // FULL SWING — the acoustic strike (most reliable). PUTT — skip it: a
    // putt is quiet, the strike won't reliably fire, so we derive impact from
    // pose motion in step 2 instead (never trust an acoustic "strike" for a
    // putt — it would be noise).
    const rawImpactMs = isPutt
      ? null
      : typeof input.impactMs === 'number' && Number.isFinite(input.impactMs)
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

    // ── 2. Top + backswing-start (+ putt impact) from pose ──────────
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

          // ── PUTT IMPACT (pose, no acoustic) ──────────────────────
          // A putt is quiet, so impact = the FORWARD-STROKE PASS through the
          // ball, read from the same wrist-y series: after the top (hands
          // highest, the backstroke reversal), the hands move back DOWN/forward
          // toward address. We take impact as the first post-top frame whose
          // wrist-y returns to ~address height (the forward stroke passing back
          // through the ball line). Falls back to the series' last sample if it
          // never fully returns (so a clipped clip still yields a stroke span).
          if (isPutt && impactSec == null) {
            const addressY = series[0].y;
            const topY = series[topIdx].y;
            const travel = addressY - topY; // positive: hands rose into the backstroke
            let puttImpactSec: number | null = null;
            if (travel > 0) {
              const returnDelta = travel * 0.8; // ~80% back down toward address = forward pass
              for (let i = topIdx + 1; i < series.length; i++) {
                if (addressY - series[i].y <= travel - returnDelta) {
                  puttImpactSec = series[i].t;
                  break;
                }
              }
              // Never fully returned in-window → use the last frame as the
              // forward-stroke endpoint (honest, low-confidence; the user can
              // scrub to the true ball-pass).
              if (puttImpactSec == null && topIdx < series.length - 1) {
                puttImpactSec = series[series.length - 1].t;
              }
            }
            if (puttImpactSec != null && puttImpactSec > topSec) {
              impactSec = puttImpactSec;
              phases.impactSec = puttImpactSec;
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

    // Putt detection is pose-only, small and quiet → never claim 'auto'. Cap
    // a fully-detected putt at 'partial' so the UI keeps inviting a refine.
    const confidence: DetectTempoOutput['confidence'] =
      detected === 3 ? (isPutt ? 'partial' : 'auto') : detected > 0 ? 'partial' : 'none';

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
