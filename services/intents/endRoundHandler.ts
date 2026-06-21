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

    const history = useRoundStore.getState().roundHistory;
    const rec = history[history.length - 1];
    let summaryLine = "Round's in the books.";
    if (rec && rec.holesPlayed >= 9) {
      const vp = rec.scoreVsPar ?? 0;
      const vpStr = vp === 0 ? 'even' : vp > 0 ? `+${vp}` : `${vp}`;
      summaryLine = `Round's in the books — ${rec.totalScore} at ${rec.courseName ?? 'the course'}, ${vpStr}. Check your recap for the full breakdown.`;
    }

    return {
      success: true,
      voice_response: summaryLine,
      side_effects: [`endRound:${roundId}`],
      follow_up_needed: false,
      tool_action: { type: 'navigate_replace', path: `/recap/${roundId}` },
    };
  },
};
