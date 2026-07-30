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
    // 2026-07-31 (Tim — "no canned voice blocking the AI"). "help me read this putt" / "help me with my
    // slice" is a COACHING request, not a capabilities query — it must reach the brain, not the fixed
    // command menu. Only a bare "what can I say / help / what are my options" gets the menu; "help me
    // <do X>" (or "help with X") defers to the brain.
    const raw = String((_intent as { raw_text?: unknown }).raw_text ?? '').toLowerCase().trim();
    if (/\bhelp\s+me\b/.test(raw) || /\bhelp\s+with\b/.test(raw)) {
      return { success: false, voice_response: null, side_effects: ['help:coaching:route_to_brain'], follow_up_needed: false };
    }
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
