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
