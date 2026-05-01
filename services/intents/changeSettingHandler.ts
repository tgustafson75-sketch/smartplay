import type { IntentHandler, IntentResult, VoiceIntent, AppContext } from '../../types/voiceIntent';
import { useSettingsStore } from '../../store/settingsStore';
import { useRoundStore } from '../../store/roundStore';
import type { RoundMode } from '../../types/patterns';

function asBool(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const s = v.toLowerCase();
    if (s === 'true' || s === 'on' || s === 'yes' || s === 'enable' || s === 'enabled') return true;
    if (s === 'false' || s === 'off' || s === 'no' || s === 'disable' || s === 'disabled') return false;
  }
  return null;
}

export const changeSettingHandler: IntentHandler = {
  intent_type: 'change_setting',

  parameter_schema: {
    setting_name: 'one of: theme, voice_enabled, discrete_mode, auto_listen, language, response_mode',
    new_value: 'theme: light|dark|system; voice_enabled/discrete_mode/auto_listen: boolean; language: en|es|zh; response_mode: short|neutral|detailed',
  },

  examples: [
    'switch to dark mode',
    'turn on always-listening',
    'mute Kevin',
    'switch to Spanish',
    'be more concise',
  ],

  async execute(intent: VoiceIntent, _context: AppContext): Promise<IntentResult> {
    const setting = String(intent.parameters.setting_name ?? '').toLowerCase();
    const rawValue = intent.parameters.new_value;
    const settings = useSettingsStore.getState();

    switch (setting) {
      case 'theme': {
        const v = String(rawValue ?? '').toLowerCase();
        if (v !== 'light' && v !== 'dark' && v !== 'system') {
          return clarify('Light, dark, or system?');
        }
        settings.setThemePreference(v);
        return ack(`Switched to ${v} mode.`, ['theme:' + v]);
      }

      case 'voice_enabled': {
        const v = asBool(rawValue);
        if (v === null) return clarify('On or off?');
        settings.setVoiceEnabled(v);
        return ack(v ? 'Voice on.' : 'Muted.', ['voice_enabled:' + v]);
      }

      case 'discrete_mode': {
        const v = asBool(rawValue);
        if (v === null) return clarify('Discrete mode on or off?');
        settings.setDiscreteMode(v);
        return ack(v ? 'Discrete mode on.' : 'Discrete mode off.', ['discrete_mode:' + v]);
      }

      case 'auto_listen': {
        const v = asBool(rawValue);
        if (v === null) return clarify('Always-listening on or off?');
        settings.setAutoListenEnabled(v);
        return ack(v ? 'Always-listening on.' : 'Always-listening off.', ['auto_listen:' + v]);
      }

      case 'language': {
        const v = String(rawValue ?? '').toLowerCase();
        if (v !== 'en' && v !== 'es' && v !== 'zh') {
          return clarify('English, Spanish, or Chinese?');
        }
        settings.setLanguage(v);
        const label = v === 'en' ? 'English' : v === 'es' ? 'Spanish' : 'Chinese';
        return ack(`Switched to ${label}.`, ['language:' + v]);
      }

      case 'response_mode': {
        const v = String(rawValue ?? '').toLowerCase();
        if (v !== 'short' && v !== 'neutral' && v !== 'detailed') {
          return clarify('Short, neutral, or detailed?');
        }
        settings.setResponseMode(v);
        return ack(`Got it — ${v} responses.`, ['response_mode:' + v]);
      }

      case 'round_mode': {
        const v = String(rawValue ?? '').toLowerCase().replace(/\s+/g, '_');
        const valid: RoundMode[] = ['break_100', 'break_90', 'break_80', 'free_play'];
        if (!valid.includes(v as RoundMode)) {
          return clarify('Break 100, break 90, break 80, or free play?');
        }
        const round = useRoundStore.getState();
        round.setCurrentRoundMode(v as RoundMode);
        const label = v === 'free_play' ? 'free play' : v.replace('_', ' ');
        return ack(`Switched to ${label}.`, ['round_mode:' + v]);
      }

      default:
        return {
          success: false,
          voice_response: 'Which setting — theme, voice, language, or response length?',
          side_effects: ['unknown_setting:' + setting],
          follow_up_needed: true,
        };
    }
  },
};

function ack(msg: string, side_effects: string[]): IntentResult {
  return { success: true, voice_response: msg, side_effects, follow_up_needed: false };
}

function clarify(question: string): IntentResult {
  return { success: false, voice_response: question, side_effects: ['clarify'], follow_up_needed: true };
}
