import type { IntentHandler, IntentResult, VoiceIntent, AppContext } from '../../types/voiceIntent';
import { voiceHandlerRegistry } from '../voiceHandlerRegistry';

/**
 * Built-in voice capabilities that exist as part of the core intent set
 * (not screen-specific actions registered via voiceHandlerRegistry).
 * These are surfaced when the user asks "what can I say".
 */
const CORE_CAPABILITIES = [
  'open SmartVision, SmartFinder, SwingLab, scorecard, dashboard, or settings',
  'ask for your score, current hole, ghost match, or recent pattern',
  'change theme, voice, language, response style, or your round mode',
  'go back, home, next hole, previous hole, or close this screen',
  'tell me about a shot — "what\'d you hit", "how was that one", or just say what happened',
];

export const helpHandler: IntentHandler = {
  intent_type: 'help',

  parameter_schema: {},

  examples: [
    'what can I say',
    'help',
    'what are my options',
    'what voice commands work here',
  ],

  async execute(_intent: VoiceIntent, context: AppContext): Promise<IntentResult> {
    const surfaceActions = voiceHandlerRegistry.forSurface(context.active_screen);
    const screenSpecific = surfaceActions.map(a => a.description).filter(Boolean);

    const lines: string[] = [];
    if (screenSpecific.length > 0) {
      lines.push(`On this screen: ${screenSpecific.join('; ')}.`);
    }
    lines.push(`You can also: ${CORE_CAPABILITIES.slice(0, 3).join('; ')}.`);

    return {
      success: true,
      voice_response: lines.join(' '),
      side_effects: ['help:listed:' + screenSpecific.length],
      follow_up_needed: false,
    };
  },
};
