/**
 * engine/situationEngine.ts
 *
 * Pressure and Situational Awareness Engine.
 *
 * Derives a play-mode and contextual messaging from the current game state.
 * Pure function — no React, no imports, no side effects.
 *
 * Rules (in priority order):
 *   1. First shot of round       → pressure HIGH  → Mode: Safe
 *   2. Last 2 of last 3 bad      → pressure HIGH  → Mode: Safe   (bounce-back)
 *   3. 3+ straight goods in last 5 → pressure LOW → Mode: Aggressive
 *   4. Default                   → pressure NONE  → Mode: Neutral
 *
 * "Bad" shot = result not 'straight'
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type PlayMode = 'safe' | 'neutral' | 'aggressive';

export type PressureLevel = 'high' | 'elevated' | 'none';

export interface SituationInput {
  /** All shots so far this round */
  shots: Array<{ result: string; hole?: number }>;
  /** Current hole number (1-based) */
  hole: number;
  /** Current score vs par — positive = over, negative = under */
  scoreToPar: number;
  /** Manual mental state (may be overridden by detected pressure) */
  mentalState: string;
  /** Holes remaining in round */
  holesRemaining: number;
}

export interface SituationDecision {
  /** Recommended play mode for this shot */
  playMode: PlayMode;
  /** Underlying pressure level detected */
  pressureLevel: PressureLevel;
  /**
   * Short contextual message for display in the caddie card.
   * Changes based on situation — not a static template.
   */
  situationMessage: string;
  /**
   * Tone hint for voice output.
   * 'calm' = slower, softer.  'confident' = assertive.  'neutral' = default.
   */
  voiceTone: 'calm' | 'confident' | 'neutral';
  /**
   * The detected trigger that set this mode.
   * Useful for display / debugging.
   */
  trigger: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isBad(result: string): boolean {
  return result !== 'straight';
}

// ─── Engine ───────────────────────────────────────────────────────────────────

export function getSituationDecision(input: SituationInput): SituationDecision {
  const { shots, hole, scoreToPar, mentalState, holesRemaining } = input;
  const n = shots.length;

  // ── Rule 1: First tee ───────────────────────────────────────────────────
  if (n === 0) {
    return {
      playMode:        'safe',
      pressureLevel:   'high',
      situationMessage: 'First tee. Smooth swing — start clean.',
      voiceTone:       'calm',
      trigger:         'first_tee',
    };
  }

  // ── Rule 2: First shot of a fresh hole (no shots this hole yet) ──────────
  if (n === 1 && hole === 1) {
    return {
      playMode:        'safe',
      pressureLevel:   'elevated',
      situationMessage: 'Round just started. Build momentum early.',
      voiceTone:       'calm',
      trigger:         'round_start',
    };
  }

  // ── Rule 3: Bounce-back — last 2 of last 3 shots were bad ───────────────
  const last3 = shots.slice(-3);
  const recentBadCount = last3.filter((s) => isBad(s.result)).length;
  if (n >= 2 && recentBadCount >= 2) {
    return {
      playMode:        'safe',
      pressureLevel:   'high',
      situationMessage: 'Reset. Smooth swing. One shot at a time.',
      voiceTone:       'calm',
      trigger:         'bounce_back',
    };
  }

  // ── Rule 4: Single bad shot (elevated, not full pressure) ────────────────
  const lastShot = shots[n - 1];
  if (lastShot && isBad(lastShot.result) && n >= 2) {
    // Only elevated if previous was also bad
    const prevShot = shots[n - 2];
    if (prevShot && isBad(prevShot.result)) {
      return {
        playMode:        'safe',
        pressureLevel:   'elevated',
        situationMessage: 'Stay patient — reset your routine.',
        voiceTone:       'calm',
        trigger:         'back_to_back_misses',
      };
    }
  }

  // ── Rule 5: Dialed in — 3+ straight in last 5 ───────────────────────────
  const last5 = shots.slice(-5);
  const recentGoodCount = last5.filter((s) => !isBad(s.result)).length;
  if (last5.length >= 4 && recentGoodCount >= 3) {
    return {
      playMode:        'aggressive',
      pressureLevel:   'none',
      situationMessage: "You're dialed in. Stay aggressive.",
      voiceTone:       'confident',
      trigger:         'hot_streak',
    };
  }

  // ── Rule 6: Under par — press the advantage ──────────────────────────────
  if (scoreToPar <= -2 && holesRemaining > 3) {
    return {
      playMode:        'aggressive',
      pressureLevel:   'none',
      situationMessage: `${Math.abs(scoreToPar)} under — keep the momentum going.`,
      voiceTone:       'confident',
      trigger:         'under_par',
    };
  }

  // ── Rule 7: Late-round with bad score — protect ──────────────────────────
  if (scoreToPar >= 5 && holesRemaining <= 4) {
    return {
      playMode:        'safe',
      pressureLevel:   'elevated',
      situationMessage: 'Protect your score. Smart targets only.',
      voiceTone:       'calm',
      trigger:         'late_round_protect',
    };
  }

  // ── Rule 8: Manual mental state override ────────────────────────────────
  if (mentalState === 'nervous' || mentalState === 'pressure') {
    return {
      playMode:        'safe',
      pressureLevel:   'elevated',
      situationMessage: 'Breathe. One smooth swing.',
      voiceTone:       'calm',
      trigger:         'mental_state_nervous',
    };
  }
  if (mentalState === 'confident' || mentalState === 'aggressive') {
    return {
      playMode:        'aggressive',
      pressureLevel:   'none',
      situationMessage: 'Back yourself — commit hard.',
      voiceTone:       'confident',
      trigger:         'mental_state_confident',
    };
  }
  if (mentalState === 'frustrated') {
    return {
      playMode:        'safe',
      pressureLevel:   'elevated',
      situationMessage: 'Let it go. Smooth tempo and through.',
      voiceTone:       'calm',
      trigger:         'mental_state_frustrated',
    };
  }

  // ── Default: neutral ─────────────────────────────────────────────────────
  return {
    playMode:        'neutral',
    pressureLevel:   'none',
    situationMessage: 'Pick a target and commit.',
    voiceTone:       'neutral',
    trigger:         'default',
  };
}

// ─── Helpers for UI ───────────────────────────────────────────────────────────

/** Label, color, and icon for the mode badge */
export function getPlayModeDisplay(mode: PlayMode): {
  label: string;
  color: string;
  bg: string;
  icon: string;
} {
  switch (mode) {
    case 'safe':
      return { label: 'Mode: Safe',       color: '#93c5fd', bg: 'rgba(59,130,246,0.15)', icon: '🛡️' };
    case 'aggressive':
      return { label: 'Mode: Aggressive', color: '#4ade80', bg: 'rgba(74,222,128,0.15)', icon: '🎯' };
    default:
      return { label: 'Mode: Neutral',    color: '#9ca3af', bg: 'rgba(255,255,255,0.07)', icon: '⚖️' };
  }
}
