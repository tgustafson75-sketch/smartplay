import type { IntentHandler, IntentResult, VoiceIntent, AppContext } from '../../types/voiceIntent';
import { useRoundStore } from '../../store/roundStore';
import { track } from '../analytics';
import { promptEndRound } from '../round/endRoundFlow';

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

    // 2026-07-29 (Tim — "say/type 'end round' crashes; you HAVE to choose save or discard"). Ending a
    // round is destructive-or-persistent, so it must offer the SAME Save/Discard choice every on-screen
    // path does — never silently auto-save. Previously this handler called endRound() itself and then
    // returned a navigate_replace straight to /recap/<id>; that divergent immediate path (the ONLY one
    // that skipped the choice + used replace instead of the feelings→recap push) is what crashed. Now
    // it defers entirely to the shared save/discard flow (the Alert + endRound + feelings→recap push),
    // and returns NO tool_action — so there's no auto-end and no navigate_replace on this path.
    promptEndRound();
    track('end_round_voice', {});

    return {
      success: true,
      // Natural spoken prompt that matches the Save/Discard choice now on screen.
      voice_response: 'Nice work out there. Want me to save this round to your history, or discard it?',
      side_effects: ['endRound:prompted'],
      follow_up_needed: false,
    };
  },
};
