/**
 * 2026-08-25 (Tim — "refine the tempo trainer... only things that are elite and ready for prime
 * time") — TRAIN AGAINST YOUR OWN SWING, NOT A GENERIC BEAT.
 *
 * The Tempo Trainer was a blind metronome: it set a target and never once told the player whether
 * they matched it. Meanwhile SmartMotion measures backswing:downswing on every analysed swing and
 * has been writing it to the player model all along. The target and the measurement never met —
 * a learn-loop with both ends built and no middle.
 *
 * TWO THINGS THE RATIO ALONE CANNOT DO, which is why backswing duration is read too:
 * within a mode every preset is the SAME ratio (3:1) and differs only in SPEED — 1000ms backswing
 * down to 700ms. So the ratio says how the player's transition compares to the ideal, and the
 * backswing duration says which preset to hand them first.
 *
 * HONESTY RULES, deliberately conservative:
 *  - Under MIN_SAMPLES this says it does not know yet. It never shows a made-up number.
 *  - A measured 2.2:1 does NOT mean "go train at 2:1". It means the transition is quick and the
 *    target is still 3:1. The short-game mode is for short swings, never a consolation ratio.
 *  - The read is an observation about their swings, never a promise that the drill will fix it.
 */

/** Below this, the EWMA is too green to show the player a number. */
export const MIN_SAMPLES = 5;

/** Inside this band of the ideal, a player is "on it" rather than quick or long. */
const ON_TARGET_BAND = 0.3;

export interface TempoPresetLike {
  readonly key: string;
  readonly label: string;
  /** Backswing duration in ms for this preset. */
  readonly back: number;
  readonly down: number;
}

export interface TempoSelfRead {
  /** False when there is not yet enough measured swing to say anything true. */
  known: boolean;
  ratio: number | null;
  backswingMs: number | null;
  samples: number;
  /** The preset to start them on, chosen from their own backswing speed. Null = leave the default. */
  suggestedPresetKey: string | null;
  /** One line for the player. Always safe to render. */
  line: string;
}

export function readOwnTempo(
  metrics: { tempoAvg?: number | null; tempoSamples?: number; backswingAvgMs?: number | null } | null | undefined,
  presets: readonly TempoPresetLike[],
  idealRatio: number,
): TempoSelfRead {
  const samples = metrics?.tempoSamples ?? 0;
  const ratio = typeof metrics?.tempoAvg === 'number' && Number.isFinite(metrics.tempoAvg) ? metrics.tempoAvg : null;
  const backswingMs =
    typeof metrics?.backswingAvgMs === 'number' && Number.isFinite(metrics.backswingAvgMs) ? metrics.backswingAvgMs : null;

  if (samples < MIN_SAMPLES || ratio == null) {
    return {
      known: false,
      ratio: null,
      backswingMs: null,
      samples,
      suggestedPresetKey: null,
      line: samples > 0
        ? `Record ${MIN_SAMPLES - samples} more swing${MIN_SAMPLES - samples === 1 ? '' : 's'} in SmartMotion and I'll set this drill to your own tempo.`
        : "Record a few swings in SmartMotion and I'll set this drill to your own tempo.",
    };
  }

  // Nearest preset by backswing SPEED — the only axis presets actually vary on.
  let suggestedPresetKey: string | null = null;
  if (backswingMs != null && presets.length > 0) {
    let best = presets[0]!;
    for (const p of presets) {
      if (Math.abs(p.back - backswingMs) < Math.abs(best.back - backswingMs)) best = p;
    }
    suggestedPresetKey = best.key;
  }

  const shown = ratio.toFixed(1);
  const ideal = idealRatio.toFixed(1);
  const label = suggestedPresetKey ? presets.find((p) => p.key === suggestedPresetKey)?.label ?? null : null;
  const startAt = label ? ` Start at ${label}.` : '';

  let line: string;
  if (ratio < idealRatio - ON_TARGET_BAND) {
    line = `Your swings measure ${shown}:1 — quicker into the strike than the ${ideal}:1 target. Let the backswing breathe.${startAt}`;
  } else if (ratio > idealRatio + ON_TARGET_BAND) {
    line = `Your swings measure ${shown}:1 — the backswing runs long against the ${ideal}:1 target.${startAt}`;
  } else {
    line = `Your swings measure ${shown}:1, right on the ${ideal}:1 target. This one is about holding it.${startAt}`;
  }

  return { known: true, ratio, backswingMs, samples, suggestedPresetKey, line };
}
