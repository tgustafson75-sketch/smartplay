import type { ShotOutcome } from '../types/shot';
import type { RulesDecision } from '../types/penalty';

export interface PenaltyResolution {
  outcome: ShotOutcome;
  penalty_strokes: number;
  rules_decision?: RulesDecision;
  kevin_voice_line?: string;
  requires_choice: boolean;
}

export function resolvePenalty(
  outcome: ShotOutcome,
  rulesDecision?: RulesDecision,
): PenaltyResolution {
  switch (outcome) {
    case 'water':
      return {
        outcome,
        penalty_strokes: 1,
        kevin_voice_line: "Water — that's one and a drop. Take your time.",
        requires_choice: false,
      };

    case 'ob':
      if (!rulesDecision) {
        return {
          outcome,
          penalty_strokes: 0,
          kevin_voice_line:
            "OB — stroke and distance, or play it forward as a local rule? " +
            "Stroke and distance is the rule, but most public courses allow you to drop where it crossed the line.",
          requires_choice: true,
        };
      }
      return {
        outcome,
        penalty_strokes: rulesDecision === 'stroke_and_distance' ? 2 : 1,
        rules_decision: rulesDecision,
        requires_choice: false,
      };

    case 'lost':
      if (!rulesDecision) {
        return {
          outcome,
          penalty_strokes: 0,
          kevin_voice_line:
            "Lost ball — stroke and distance puts you back where you hit from, " +
            "or most courses let you drop forward with one penalty. Your call.",
          requires_choice: true,
        };
      }
      return {
        outcome,
        penalty_strokes: rulesDecision === 'stroke_and_distance' ? 2 : 1,
        rules_decision: rulesDecision,
        requires_choice: false,
      };

    case 'hazard_drop':
      return {
        outcome,
        penalty_strokes: 1,
        kevin_voice_line: "Drop within two club-lengths, no closer to the hole. Take a breath.",
        requires_choice: false,
      };

    case 'unplayable':
      return {
        outcome,
        penalty_strokes: 1,
        kevin_voice_line:
          "Unplayable — three options: back where you came from, two club-lengths sideways, " +
          "or back-on-line. Two clubs sideways is the most common.",
        requires_choice: false,
      };

    case 'manual_penalty':
      return {
        outcome,
        penalty_strokes: 1,
        requires_choice: false,
        // no kevin_voice_line — user initiated from More Menu; Kevin already acknowledged it
      };

    case 'clean':
    default:
      return {
        outcome: 'clean',
        penalty_strokes: 0,
        requires_choice: false,
      };
  }
}
