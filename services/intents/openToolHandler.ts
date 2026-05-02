import type { IntentHandler, IntentResult, VoiceIntent, AppContext } from '../../types/voiceIntent';
import type { ToolAction } from '../../app/api/kevin+api';

const TOOL_NAME_TO_ACTION: Record<string, ToolAction | { type: 'navigate'; path: string }> = {
  smartvision: { type: 'open_smartvision' },
  smartfinder: { type: 'open_smartfinder' },
  swinglab:    { type: 'open_swinglab' },
  scorecard:   { type: 'navigate', path: '/(tabs)/scorecard' },
  dashboard:   { type: 'navigate', path: '/(tabs)/dashboard' },
  settings:    { type: 'navigate', path: '/settings' },
  // Phase H — Lie Analysis Tool. Voice triggers ("what should I do here",
  // "analyze my lie", "what's my play", etc.) classify into open_tool with
  // tool_name=lie_analysis. The intent's parameters may also carry a
  // play_intent flag ("aggressive" or "conservative") for the analysis
  // pipeline to weight the recommendation.
  lie_analysis: { type: 'navigate', path: '/lie-analysis' },
};

const TOOL_LABEL: Record<string, string> = {
  smartvision: 'SmartVision',
  smartfinder: 'SmartFinder',
  swinglab:    'SwingLab',
  scorecard:   'your scorecard',
  dashboard:   'your dashboard',
  settings:    'settings',
  lie_analysis: 'Lie Analysis',
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
        voice_response: 'Which tool — SmartVision, SmartFinder, SwingLab, scorecard, dashboard, or settings?',
        side_effects: ['unknown_tool'],
        follow_up_needed: true,
      };
    }

    if (action.type === 'navigate') {
      try {
        const { router } = await import('expo-router');
        // Phase H — pass play_intent through as a query param for /lie-analysis
        if (toolName === 'lie_analysis') {
          const playIntent = String(intent.parameters.play_intent ?? '').toLowerCase();
          const path = (playIntent === 'aggressive' || playIntent === 'conservative')
            ? `${action.path}?intent=${playIntent}`
            : action.path;
          router.push(path as never);
        } else {
          router.push(action.path as never);
        }
      } catch (err) {
        console.log('[openToolHandler] navigate failed:', err);
      }
      return {
        success: true,
        voice_response: toolName === 'lie_analysis' ? 'Let me look.' : 'Opening ' + TOOL_LABEL[toolName] + '.',
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
