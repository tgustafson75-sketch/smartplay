import type { IntentHandler, IntentResult, VoiceIntent, AppContext } from '../../types/voiceIntent';
import type { ToolAction } from '../../app/api/kevin+api';

const TOOL_NAME_TO_ACTION: Record<string, ToolAction | { type: 'navigate'; path: string }> = {
  smartvision: { type: 'open_smartvision' },
  smartfinder: { type: 'open_smartfinder' },
  swinglab:    { type: 'open_swinglab' },
  scorecard:   { type: 'navigate', path: '/(tabs)/scorecard' },
  dashboard:   { type: 'navigate', path: '/(tabs)/dashboard' },
  settings:    { type: 'navigate', path: '/settings' },
  // Phase H — Lie analysis camera tool. Phase AS — branded "TightLie"
  // for users (golf-flavored, recognizable term). Voice triggers
  // ("open TightLie", "check my lie", "what's the play", "analyze my
  // lie", "tight lie", etc.) classify into open_tool with
  // tool_name=lie_analysis (internal name kept; user-facing label
  // changed). play_intent parameter ("aggressive"/"conservative")
  // weights the analysis recommendation.
  lie_analysis: { type: 'navigate', path: '/lie-analysis' },
  // Phase AS — alias so the classifier can also emit tool_name=tightlie
  // and we route the same place. Both names work end-to-end.
  tightlie: { type: 'navigate', path: '/lie-analysis' },
  // Phase 403 — SmartMotion quick swing capture (course mode). Goes
  // straight to camera + acoustic-armed stop; no bullseye / distance
  // calibration setup (that flow lives at /swinglab/cage-drill for
  // cage-mode practice). Aliases: "smartmotion", "smart_motion",
  // "smart motion" — the classifier normalizes spaces/underscores so
  // any of these reaches us as tool_name='smartmotion'.
  smartmotion: { type: 'navigate', path: '/smartmotion-quick' },
  smart_motion: { type: 'navigate', path: '/smartmotion-quick' },
  // 2026-05-19 — Acoustic Test Bench (Phase BO.1) was reachable via
  // SwingLab tile but had no voice intent route. The classifier could
  // emit tool_name='acoustic' / 'acoustic_test' / 'test_bench' but
  // the handler returned "unknown tool" because the map didn't list
  // it. Now all three variants resolve to /acoustic-test.
  acoustic: { type: 'navigate', path: '/acoustic-test' },
  acoustic_test: { type: 'navigate', path: '/acoustic-test' },
  test_bench: { type: 'navigate', path: '/acoustic-test' },
  // 2026-05-19 — Owner GPS Test Bench voice intent. Same gating as
  // Settings → Owner Tools — non-owners get the same "unknown tool"
  // reply via the route's own gate. Aliases catch obvious phrasings.
  gps_test: { type: 'navigate', path: '/gps-test' },
  gps_test_bench: { type: 'navigate', path: '/gps-test' },
  // 2026-05-19 — Mark Green tool for capturing real per-hole green
  // coords when course geometry is missing / wrong. Aliases.
  mark_green: { type: 'navigate', path: '/mark-green' },
  markgreen: { type: 'navigate', path: '/mark-green' },
};

const TOOL_LABEL: Record<string, string> = {
  smartvision: 'SmartVision',
  smartfinder: 'SmartFinder',
  swinglab:    'SwingLab',
  scorecard:   'your scorecard',
  dashboard:   'your dashboard',
  settings:    'settings',
  // Phase AS — user-facing label is now "TightLie". Internal key stays
  // lie_analysis to avoid file/route renames.
  lie_analysis: 'TightLie',
  tightlie: 'TightLie',
  smartmotion: 'SmartMotion',
  smart_motion: 'SmartMotion',
  acoustic: 'Acoustic Test Bench',
  acoustic_test: 'Acoustic Test Bench',
  test_bench: 'Acoustic Test Bench',
  gps_test: 'GPS Test Bench',
  gps_test_bench: 'GPS Test Bench',
  mark_green: 'Mark Green',
  markgreen: 'Mark Green',
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
    // Phase 403 — SmartMotion quick swing capture.
    'open SmartMotion',
    'start SmartMotion',
    'record my swing',
    'capture my swing',
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
        // Phase H — pass play_intent through as a query param for /lie-analysis.
        // Phase AS — TightLie alias also routes here.
        if (toolName === 'lie_analysis' || toolName === 'tightlie') {
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
        voice_response: (toolName === 'lie_analysis' || toolName === 'tightlie')
          ? 'Let me look.'
          : 'Opening ' + TOOL_LABEL[toolName] + '.',
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
