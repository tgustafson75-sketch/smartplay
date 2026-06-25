import type { IntentHandler, IntentResult, VoiceIntent, AppContext } from '../../types/voiceIntent';
import { useSettingsStore, type Persona } from '../../store/settingsStore';
import { useRoundStore } from '../../store/roundStore';
import { useGhostStore } from '../../store/ghostStore';
import type { RoundMode } from '../../types/patterns';
import { getCaddieName } from '../../lib/persona';

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
    setting_name: 'one of: theme, voice_enabled, auto_listen, language, response_mode, caddie_persona',
    new_value: 'theme: light|dark|system; voice_enabled/auto_listen: boolean; language: en|es|zh; response_mode: short|neutral|detailed; caddie_persona: kevin|tank|serena|harry',
  },

  examples: [
    'switch to dark mode',
    'turn on active listening',
    'mute Kevin',
    'switch to Spanish',
    'be more concise',
    'switch to Tank',
    'change caddie to Serena',
    'put Harry in charge',
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

      case 'auto_listen': {
        const v = asBool(rawValue);
        if (v === null) return clarify('Always-listening on or off?');
        settings.setAutoListenEnabled(v);
        return ack(v ? 'Always-listening on.' : 'Always-listening off.', ['auto_listen:' + v]);
      }

      case 'cart_mode': {
        const v = asBool(rawValue);
        if (v === null) return clarify('Cart mode on or off?');
        settings.setCartMode(v);
        return ack(
          v ? 'Cart mode on — tightened up shot detection for the cart.'
            : 'Cart mode off — back to walking defaults.',
          ['cart_mode:' + v],
        );
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

      case 'ghost':
      case 'ghost_round':
      case 'ghost_mode': {
        const v = asBool(rawValue);
        if (v === null) return clarify('Ghost mode on or off?');
        const settingsState = useSettingsStore.getState();
        settingsState.setGhostAutoActivate(v);
        const round = useRoundStore.getState();
        if (!v) {
          // Off → wipe any active ghost so the row disappears immediately.
          round.clearActiveGhost();
          useGhostStore.getState().deactivateGhost();
          return ack('Ghost off — playing this round solo.', ['ghost:off']);
        }
        // On → if a round is active and we have a prior round on the same
        // course, activate it now (otherwise the setting just enables for
        // the NEXT round).
        if (round.isRoundActive && round.activeCourseId) {
          const prior = round.roundHistory
            .filter(r => r.courseId === round.activeCourseId && r.totalScore > 0 && r.holesPlayed >= 1 && r.id !== round.currentRoundId)
            .sort((a, b) => b.endedAt - a.endedAt);
          const auto = prior[0];
          if (auto) {
            const label = `${auto.courseName ?? 'Past round'} (${auto.totalScore})`;
            round.setActiveGhost({ source_round_id: auto.id, label });
            useGhostStore.getState().activateGhost(auto);
            return ack(`Ghost on — pacing against ${label}.`, ['ghost:on:activated']);
          }
        }
        return ack('Ghost on — I\'ll pull up your last round next time you tee it up here.', ['ghost:on:no_prior']);
      }

      case 'family_recording':
      case 'family':
      case 'record_family': {
        // 2026-05-22 — Family Coaching capture session start/stop.
        // new_value is either "stop" / "off" / "end" to end the
        // session, or a roster member name to start one. Lookup is
        // case-insensitive against family.firstName OR nickname.
        const v = String(rawValue ?? '').trim();
        if (!v) return clarify("Whose swing — say their name?");
        const lower = v.toLowerCase();
        const fam = await import('../../store/familyStore');
        const gv = await import('../glassesVisionInput');
        if (lower === 'stop' || lower === 'off' || lower === 'end' || lower === 'me') {
          gv.endFamilyRecording();
          return ack('Stopped — back to you.', ['family_recording:stop']);
        }
        const member = fam.useFamilyStore.getState().findByName(v);
        if (!member) {
          return clarify(
            `I don\'t have ${v} on the family roster yet. Add them in Settings → Family first.`,
          );
        }
        gv.beginFamilyRecording(member.id);
        return ack(
          `Recording ${member.firstName}\'s swing — tee it up and let it rip.`,
          [`family_recording:${member.id}`],
        );
      }

      case 'caddie_persona':
      case 'caddie':
      case 'persona': {
        const v = String(rawValue ?? '').toLowerCase();
        const valid: Persona[] = ['kevin', 'tank', 'serena', 'harry'];
        if (!valid.includes(v as Persona)) {
          return clarify('Kevin, Tank, Serena, or Harry?');
        }
        settings.setCaddiePersonality(v as Persona);
        const newName = getCaddieName(v as Persona);
        return ack(`${newName} here. I've got you.`, ['caddie_persona:' + v]);
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
