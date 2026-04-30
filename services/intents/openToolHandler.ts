import type { IntentHandler, IntentResult, VoiceIntent, AppContext } from '../../types/voiceIntent';
import type { ToolAction } from '../../app/api/kevin+api';

const TOOL_NAME_TO_ACTION: Record<string, ToolAction | { type: 'navigate'; path: string }> = {
  smartvision: { type: 'open_smartvision' },
  smartfinder: { type: 'open_smartfinder' },
  swinglab:    { type: 'open_swinglab' },
  scorecard:   { type: 'navigate', path: '/(tabs)/scorecard' },
};

const TOOL_LABEL: Record<string, string> = {
  smartvision: 'SmartVision',
  smartfinder: 'SmartFinder',
  swinglab:    'SwingLab',
  scorecard:   'your scorecard',
};

export const openToolHandler: IntentHandler = {
  intent_type: 'open_tool',

  parameter_schema: {
    tool_name: 'one of: smartvision, smartfinder, swinglab, scorecard',
  },

  examples: [
    'open SmartVision',
    'show me the smart finder',
    'pull up SwingLab',
    'show my scorecard',
    'open the rangefinder',
  ],

  async execute(intent: VoiceIntent, _context: AppContext): Promise<IntentResult> {
    const toolName = String(intent.parameters.tool_name ?? '').toLowerCase();
    const action = TOOL_NAME_TO_ACTION[toolName];

    if (!action) {
      return {
        success: false,
        voice_response: 'Which tool — SmartVision, SmartFinder, SwingLab, or scorecard?',
        side_effects: ['unknown_tool'],
        follow_up_needed: true,
      };
    }

    if (action.type === 'navigate') {
      try {
        const { router } = await import('expo-router');
        router.push(action.path as never);
      } catch (err) {
        console.log('[openToolHandler] navigate failed:', err);
      }
      return {
        success: true,
        voice_response: 'Opening ' + TOOL_LABEL[toolName] + '.',
        side_effects: ['navigate:' + action.path],
        follow_up_needed: false,
      };
    }

    return {
      success: true,
      voice_response: 'Opening ' + TOOL_LABEL[toolName] + '.',
      side_effects: ['tool_action:' + action.type],
      follow_up_needed: false,
      tool_action: action,
    };
  },
};
