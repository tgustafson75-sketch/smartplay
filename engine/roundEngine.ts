/**
 * engine/roundEngine.ts
 *
 * Round Intelligence — tracks in-round momentum, streaks, and pressure moments.
 * Pure functions — no React, no storage, no side-effects.
 * The caller (CaddieContext / PlayScreen) owns the state and calls updateRoundState
 * after every recorded shot.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type ShotResult = 'left' | 'right' | 'straight' | 'center' | string;

export interface RoundShot {
  result: ShotResult;
  club?:  string;
  hole?:  number;
}

export type Momentum = 'positive' | 'negative' | 'neutral';
export type Streak   = 'right' | 'left' | null;

export interface RoundState {
  /** Last 3 shots — sliding window used for streak + momentum */
  recentShots: RoundShot[];
  /** Non-null when all 3 recent shots missed the same direction */
  streak: Streak;
  /** How the round is trending based on recent contact quality */
  momentum: Momentum;
  /** True when the shot is on a pressure hole or inside scoring range */
  pressure: boolean;
  /** Total shots recorded this round (for proactive message throttling) */
  totalShots: number;
  /** Shot index of the last proactive message, to avoid repetition */
  lastInsightAt: number;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export const createRoundState = (): RoundState => ({
  recentShots:   [],
  streak:        null,
  momentum:      'neutral',
  pressure:      false,
  totalShots:    0,
  lastInsightAt: -3, // allow first insight immediately
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const isOnTarget = (result: ShotResult): boolean =>
  result === 'straight' || result === 'center';

// ─── Update ───────────────────────────────────────────────────────────────────

/**
 * Record a new shot and recalculate round intelligence.
 * Context is used only for pressure detection (hole number, distance).
 */
export const updateRoundState = (
  state: RoundState,
  shot: RoundShot,
  context: { hole?: number; distance?: number | null },
): RoundState => {
  const recentShots = [...state.recentShots, shot].slice(-3);
  const results     = recentShots.map((s) => s.result);

  // ── Streak: all 3 recent shots to the same side ──────────────────────────
  let streak: Streak = null;
  if (results.length === 3) {
    if (results.every((r) => r === 'right')) streak = 'right';
    else if (results.every((r) => r === 'left')) streak = 'left';
  }

  // ── Momentum: majority on-target = positive, majority off = negative ─────
  const onTargetCount  = results.filter(isOnTarget).length;
  const offTargetCount = results.filter((r) => !isOnTarget(r)).length;
  let momentum: Momentum = 'neutral';
  if (onTargetCount  >= 2) momentum = 'positive';
  else if (offTargetCount >= 2) momentum = 'negative';

  // ── Pressure: opener, closer, or inside 150 yds ──────────────────────────
  const pressure =
    context.hole === 1 ||
    context.hole === 18 ||
    (context.distance != null && context.distance <= 150);

  return {
    ...state,
    recentShots,
    streak,
    momentum,
    pressure,
    totalShots: state.totalShots + 1,
  };
};

// ─── Insight ──────────────────────────────────────────────────────────────────

/**
 * Generate a proactive caddie insight from the current round state.
 *
 * Returns null when:
 *   - Nothing notable is happening
 *   - An insight was already given within the last 2 shots (avoids repetition)
 */
export const generateRoundInsight = (
  roundState: RoundState,
): string | null => {
  const { streak, momentum, pressure, totalShots, lastInsightAt } = roundState;

  // Throttle: don't fire again within 2 shots of the last insight
  if (totalShots - lastInsightAt < 2) return null;

  if (streak === 'right') {
    return "Three in a row right — let's aim left of center here.";
  }
  if (streak === 'left') {
    return "Been pulling it left — start this one right of the flag.";
  }
  if (momentum === 'positive') {
    return "You're swinging it well — stay with it.";
  }
  if (momentum === 'negative') {
    return "Let's reset — one smooth swing, pick a small target.";
  }
  if (pressure) {
    return "Important shot — commit to your target and trust it.";
  }

  return null;
};

/**
 * Call after generateRoundInsight returns a non-null value to record
 * when the last insight was shown.
 */
export const markInsightShown = (state: RoundState): RoundState => ({
  ...state,
  lastInsightAt: state.totalShots,
});
