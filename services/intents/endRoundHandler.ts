import type { IntentHandler, IntentResult, VoiceIntent, AppContext } from '../../types/voiceIntent';
import { useRoundStore } from '../../store/roundStore';
import { track } from '../analytics';

export const endRoundHandler: IntentHandler = {
  intent_type: 'end_round',

  parameter_schema: {},

  examples: [
    'end the round',
    "that's the round",
    'wrap up the round',
    "let's call it",
  ],

  async execute(_intent: VoiceIntent, _context: AppContext): Promise<IntentResult> {
    const round = useRoundStore.getState();
    if (!round.isRoundActive) {
      return {
        success: false,
        voice_response: "No active round to end.",
        side_effects: ['endRound:no_active_round'],
        follow_up_needed: false,
      };
    }

    const roundId = round.endRound();
    track('end_round_voice', { round_id: roundId });

    return {
      success: true,
      voice_response: "Round's in the books. Let's see how you played.",
      side_effects: [`endRound:${roundId}`],
      follow_up_needed: false,
      tool_action: { type: 'navigate', path: `/recap/${roundId}` },
    };
  },
};
