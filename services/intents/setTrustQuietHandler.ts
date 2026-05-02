/**
 * Pre-beta — Discrete Mode quick-toggle handlers.
 *
 * Voice intents that flip the global Trust Spectrum to L1 (Quiet) or
 * L2 (Companion) without making the user open the menu. Useful when
 * the player is on the tee in a quiet group, or when they want Kevin
 * back after the hole settles down.
 *
 * Speak time budget ≤ 1.5s — keep responses to one short sentence.
 */

import type { IntentHandler, IntentResult } from '../../types/voiceIntent';
import { useTrustLevelStore } from '../../store/trustLevelStore';

export const setTrustQuietHandler: IntentHandler = {
  intent_type: 'set_trust_quiet',
  parameter_schema: {},
  examples: [
    'Kevin go quiet',
    'Kevin be quiet',
    'Kevin quiet mode',
    'Kevin quiet down',
    'Kevin shush',
    'go silent',
    'quiet please',
  ],
  async execute(): Promise<IntentResult> {
    useTrustLevelStore.getState().setLevel(1);
    return {
      success: true,
      voice_response: "Got it. I'll be here when you need me.",
      side_effects: ['trust:set:quiet'],
      follow_up_needed: false,
    };
  },
};

export const setTrustCompanionHandler: IntentHandler = {
  intent_type: 'set_trust_companion',
  parameter_schema: {},
  examples: [
    'Kevin come back',
    'Kevin speak up',
    'Kevin talk to me',
    'Kevin un-quiet',
    'back to normal',
  ],
  async execute(): Promise<IntentResult> {
    useTrustLevelStore.getState().setLevel(2);
    return {
      success: true,
      voice_response: 'Back with you.',
      side_effects: ['trust:set:companion'],
      follow_up_needed: false,
    };
  },
};
