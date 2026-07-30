import type { IntentHandler, IntentResult, VoiceIntent } from '../../types/voiceIntent';

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

  async execute(intent: VoiceIntent): Promise<IntentResult> {
    // 2026-07-31 (Tim — "no canned voice blocking the AI"). A bare ack ("okay", "thanks", "got it")
    // closes silently — correct. But "okay, so what should I do about my grip?" is a real QUESTION
    // wearing an ack prefix; misclassified as `acknowledge` it went SILENT and the brain never ran.
    // If there's a question or a substantive request riding along, defer to the brain instead of
    // swallowing it.
    const raw = String((intent as { raw_text?: unknown }).raw_text ?? '').toLowerCase().trim();
    const wordCount = raw.split(/\s+/).filter(Boolean).length;
    const hasRequest = raw.includes('?') ||
      /\b(what|why|how|should|can|could|would|when|where|which|who|tell\s+me|help|show\s+me|give\s+me)\b/.test(raw);
    if (hasRequest || wordCount > 4) {
      return { success: false, voice_response: null, side_effects: ['acknowledge:has_request:route_to_brain'], follow_up_needed: false };
    }
    return {
      success: true,
      voice_response: null,
      side_effects: ['acknowledge'],
      follow_up_needed: false,
    };
  },
};
