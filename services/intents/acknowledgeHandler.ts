import type { IntentHandler, IntentResult } from '../../types/voiceIntent';

export const acknowledgeHandler: IntentHandler = {
  intent_type: 'acknowledge',

  parameter_schema: {},

  examples: [
    'thanks Kevin',
    'got it',
    'okay',
    'alright',
    'cool',
  ],

  async execute(): Promise<IntentResult> {
    return {
      success: true,
      voice_response: null,
      side_effects: ['acknowledge'],
      follow_up_needed: false,
    };
  },
};
