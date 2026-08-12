/**
 * 2026-07-29 (Tim — "trail vs lead arm logic; a lot of my faults are on my trail arm"). Pure per-wrist
 * interpretation of a watch swing. The wrist IMU means different things depending on which arm it's on:
 *
 *   LEAD wrist (left for a RH golfer) — the "steering wheel." Tracks the swing arc, so the
 *     single-pendulum club-speed estimate holds up best here. Weaker at seeing the release fault.
 *   TRAIL wrist (right for a RH golfer) — the "release/throw." An EARLY trail-wrist unhinge IS a cast
 *     / early release, so this is the better sensor for the exact faults Tim fights. Club speed off the
 *     trail wrist is a rougher proxy (the release adds local rotation the pendulum radius doesn't model).
 *
 * HONESTY: we do NOT yet have calibrated per-wrist constants (that needs real labeled swings, which the
 * working watch can now collect). So this returns hedged, DIRECTIONAL guidance + a confidence label —
 * never a fabricated "measured" fault. Pure + deterministic → unit-testable.
 */

export type Wrist = 'lead' | 'trail';

export interface WristSwingInput {
  wrist: Wrist;
  tempoGood: boolean;
  transitionDetected: boolean;
  earlyTransition: boolean;
}

export interface WristInterpretation {
  wrist: Wrist;
  /** How much to trust the club-speed number from THIS wrist placement (labeling only — the value is
   *  still the watch's estimate). Lead is the cleaner proxy; trail is rougher. */
  clubSpeedConfidence: 'estimate' | 'rough';
  /** One short, HEDGED coaching hint (directional, not a measured verdict), or null. */
  faultHint: string | null;
}

export function interpretWristSwing(s: WristSwingInput): WristInterpretation {
  const clubSpeedConfidence: 'estimate' | 'rough' = s.wrist === 'lead' ? 'estimate' : 'rough';

  let faultHint: string | null = null;
  if (s.wrist === 'trail') {
    // The trail wrist is where casting shows up: an early unhinge before impact.
    if (s.earlyTransition) {
      faultHint = 'Looks like an early release — trail wrist unhinging from the top. Feel the lag hold.';
    } else if (s.transitionDetected && !s.tempoGood) {
      faultHint = 'Trail-side transition looks snatched — smooth the change of direction.';
    } else if (s.tempoGood) {
      faultHint = 'Trail wrist held its angle — nice and connected.';
    }
  } else {
    // Lead wrist isn't the cast sensor; keep it to tempo-level, positive-only feedback.
    if (s.tempoGood) faultHint = 'Smooth tempo through the lead side.';
  }

  return { wrist: s.wrist, clubSpeedConfidence, faultHint };
}

/**
 * 2026-08-12 (Tim) — "I get the honesty gate, but there is such a thing as things we can extrapolate
 * from other data and get approximations. Remember, this is a mid-to-high handicap, not a Trackman."
 *
 * He's right, and I had the rule too tight. "Never fabricate" means never present a guess as a
 * measurement. It does not mean refuse to estimate. A mid-handicapper who learns their driver is
 * around 92 mph is better served than one shown nothing because we lacked a launch monitor — as long
 * as the number says it's an estimate and never hardens into "measured".
 *
 * THE MODEL. Wrist and clubhead swing about roughly the same centre, so their speeds scale with
 * radius: v = ωr. The wrist travels on the arm's radius; the clubhead on arm + shaft. Wrist hinge
 * release adds more on top, which is why the real ratio is higher than radius alone and why a longer
 * club separates further from the wrist than a wedge does.
 *
 * WRIST_TO_CLUB is anchored so a driver swing lands in the band a real mid-handicapper occupies
 * (~85-95 mph), and scales DOWN with club length — a sand wedge's head is barely further out than
 * the hands, so its multiple is much smaller. These are starting constants, not truth, which is
 * exactly why the result is labelled an estimate and why calibrateFromMeasured exists below.
 *
 * SELF-CALIBRATION is the honest long game ([[self-growing-agent-architecture]]): the moment we get a
 * REAL club speed for this player from any source, the per-player ratio replaces the generic one and
 * the estimate stops being generic. The constant is a starting point, not a claim.
 */
const WRIST_TO_CLUB: Record<string, number> = {
  driver: 4.2, '3w': 4.0, '5w': 3.9, hybrid: 3.8,
  '4i': 3.7, '5i': 3.6, '6i': 3.5, '7i': 3.4, '8i': 3.3, '9i': 3.2,
  pw: 3.1, gw: 3.0, sw: 2.9, lw: 2.8,
};
const DEFAULT_RATIO = 3.4; // a 7-iron — the middle of the bag when the club is unknown

export interface ClubSpeedEstimate {
  mph: number;
  /** ALWAYS an estimate. Never promote this to 'measured' without a real instrument. */
  kind: 'estimate';
  /** Lead wrist tracks the arc and estimates better; trail wrist adds release rotation. */
  confidence: 'estimate' | 'rough';
  /** True once this player's own measured swing has calibrated the ratio. */
  calibrated: boolean;
}

/** Per-player learned ratio, set by calibrateFromMeasured. Null = use the generic table. */
let learnedRatio: number | null = null;

/**
 * Teach the estimator from a REAL measurement (pose-derived club speed, a launch monitor, anything
 * genuinely measured) taken on the same swing as a wrist reading. One good pair beats the table.
 */
export function calibrateFromMeasured(measuredClubMph: number, peakWristMph: number): void {
  if (!(measuredClubMph > 20) || !(peakWristMph > 2)) return;
  const ratio = measuredClubMph / peakWristMph;
  // Reject an implausible pair rather than learning from a bad sample — the same discipline as the
  // club-distance plausibility band.
  if (ratio < 2 || ratio > 6) return;
  learnedRatio = learnedRatio == null ? ratio : learnedRatio * 0.7 + ratio * 0.3;
}

/** Estimated clubhead speed from a wrist peak. Null when there's nothing honest to say. */
export function estimateClubSpeedMph(
  peakWristMph: number,
  club: string | null | undefined,
  wrist: Wrist = 'lead',
): ClubSpeedEstimate | null {
  if (!(peakWristMph > 2)) return null;
  const key = (club ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const ratio = learnedRatio ?? WRIST_TO_CLUB[key] ?? DEFAULT_RATIO;
  const mph = Math.round(peakWristMph * ratio);
  // Outside this band it isn't a golf swing — a bumped watch, a practice waggle, a car ride.
  if (mph < 30 || mph > 140) return null;
  return {
    mph,
    kind: 'estimate',
    confidence: wrist === 'lead' ? 'estimate' : 'rough',
    calibrated: learnedRatio != null,
  };
}
