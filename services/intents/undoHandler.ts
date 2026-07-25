import type { IntentHandler, IntentResult, VoiceIntent, AppContext } from '../../types/voiceIntent';
import { useRoundStore } from '../../store/roundStore';
import { track } from '../analytics';

/**
 * 2026-07-25 (coverage audit gap) — voice "undo / scratch that / never mind / delete that".
 * Reverts the single most-recent scoring mutation (score, putts, or shot) captured by
 * roundStore.lastMutation. Deterministic + OFFLINE — a mis-logged score during a signal
 * drought is exactly when the player needs to fix it by voice, with no cloud round-trip.
 * Single-depth by design: it undoes the last thing, not a history — the caddie says what
 * it reverted so the player can undo again if needed.
 */
export const undoHandler: IntentHandler = {
  intent_type: 'undo',

  parameter_schema: {},

  examples: [
    'undo that',
    'scratch that',
    'never mind',
    'delete that shot',
    'take that back',
  ],

  async execute(_intent: VoiceIntent, _context: AppContext): Promise<IntentResult> {
    const round = useRoundStore.getState();
    if (!round.isRoundActive) {
      return {
        success: false,
        voice_response: "Nothing to undo — you're not in a round.",
        side_effects: ['undo:no_active_round'],
        follow_up_needed: false,
      };
    }
    const result = round.undoLastMutation();
    if (!result.ok) {
      return {
        success: true,
        voice_response: "Nothing to undo right now.",
        side_effects: ['undo:nothing'],
        follow_up_needed: false,
      };
    }
    track('undo_voice', {});
    return {
      success: true,
      voice_response: `Done — ${result.description}`,
      side_effects: ['undo:reverted'],
      follow_up_needed: false,
    };
  },
};
