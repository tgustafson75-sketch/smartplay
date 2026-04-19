/**
 * features/smartCaddie/engine/DecisionModifier.ts
 *
 * Adjusts the base target yardage and caddie tone based on confidence and
 * pressure signals.  Pure function — no side effects.
 */

import type { ConfidenceLevel } from './ConfidenceEngine';
import type { PressureLevel }   from './PressureEngine';

export type PlayStyle = 'aggressive' | 'conservative' | 'safe' | 'normal';

export interface ModifiedDecision {
  target: number;
  style:  PlayStyle;
  tone:   string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tone library
// ─────────────────────────────────────────────────────────────────────────────

export const getTone = ({
  confidence,
  pressure,
}: {
  confidence: ConfidenceLevel;
  pressure:   PressureLevel;
}): string => {
  if (pressure === 'high')      return 'Stay composed. Play smart here.';
  if (confidence === 'high')    return "You're swinging it well — trust it.";
  if (confidence === 'low')     return 'Reset. Smooth swing, no forcing.';
  return 'Commit to your shot.';
};

// ─────────────────────────────────────────────────────────────────────────────
// Target modifier
// ─────────────────────────────────────────────────────────────────────────────

export const modifyDecision = ({
  baseTarget,
  confidence,
  pressure,
}: {
  baseTarget:  number;
  confidence:  ConfidenceLevel;
  pressure:    PressureLevel;
}): ModifiedDecision => {
  let adjustedTarget = baseTarget;
  let style: PlayStyle = 'normal';

  // Pressure takes priority over confidence
  if (pressure === 'high') {
    adjustedTarget -= 5;
    style = 'safe';
  } else if (confidence === 'low') {
    adjustedTarget -= 10;
    style = 'conservative';
  } else if (confidence === 'high') {
    adjustedTarget += 5;
    style = 'aggressive';
  }

  const tone = getTone({ confidence, pressure });

  return { target: adjustedTarget, style, tone };
};
