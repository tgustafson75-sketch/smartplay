import type { IntentHandler, IntentResult, VoiceIntent, AppContext } from '../../types/voiceIntent';
import { useSettingsStore, type Persona } from '../../store/settingsStore';
import { useRoundStore } from '../../store/roundStore';
import { useGhostStore } from '../../store/ghostStore';
import { usePlayerProfileStore } from '../../store/playerProfileStore';
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
    setting_name: 'one of: theme, voice_enabled, auto_listen, cart_mode, language, response_mode, round_mode, ghost, caddie_persona, handedness, units, imagery, risk_mode',
    new_value: 'theme: light|dark|system; voice_enabled/auto_listen/cart_mode: boolean; language: en|es|zh; response_mode: short|neutral|detailed; caddie_persona: kevin|tank|serena|harry; handedness: left|right; units: yards|meters; imagery: satellite|static|auto (SmartVision aerial vs static hole photo)',
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
    // 2026-07-24 (final QA — "ask for settings") — handedness + units were settable in
    // the app but NOT by asking. A lefty (the app supports left-handed analysis) couldn't
    // turn it on by voice; neither could a metric player switch units.
    "I'm left-handed",
    'set me to left-handed',
    'switch to right-handed',
    'switch to meters',
    'use yards',
    'show me the satellite view',
    'switch to the static hole photo',
  ],

  async execute(intent: VoiceIntent, _context: AppContext): Promise<IntentResult> {
    const setting = String(intent.parameters.setting_name ?? '').toLowerCase();
    const rawValue = intent.parameters.new_value;
    const settings = useSettingsStore.getState();

    switch (setting) {
      /**
       * 2026-08-12 (Tim — mental state / mental coaching "dynamics") — the caddie's risk posture.
       *
       * Lives on the ROUND, not in settings, because it changes hole to hole and resets with the
       * round. Reaches the club pick through composeShotRead (near-ties only), so telling your
       * caddie to play it safe actually changes what it hands you rather than just how it talks.
       */
      case 'risk_mode': {
        const v = String(rawValue ?? '').toLowerCase();
        if (v !== 'safe' && v !== 'normal' && v !== 'aggressive') {
          return clarify('Safe, normal, or aggressive?');
        }
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { useRoundStore } = require('../../store/roundStore') as typeof import('../../store/roundStore');
        useRoundStore.getState().setRiskMode(v as 'safe' | 'normal' | 'aggressive');
        const line =
          v === 'safe' ? "Playing it safe — I'll give you the club that covers it."
          : v === 'aggressive' ? "Aggressive it is — I'll give you the club that just gets there."
          : "Back to normal — closest club to the number.";
        return ack(line, ['risk_mode:' + v]);
      }

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
        const valid: Persona[] = ['kevin', 'tank', 'serena', 'harry', 'custom'];
        if (!valid.includes(v as Persona)) {
          return clarify('Kevin, Tank, Serena, Harry, or your custom caddie?');
        }
        // 2026-07-30 (Tim — "if you name the caddie you should be able to call them by that name").
        // Activating the CUSTOM caddie must ALSO flip useCustomCaddie (that flag drives the portrait +
        // the custom voice/name everywhere); switching to a base persona turns it off. Without this, a
        // "switch to <custom name>" set the persona but left the custom caddie dormant.
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const prof = require('../../store/playerProfileStore').usePlayerProfileStore.getState();
          prof.setUseCustomCaddie?.(v === 'custom');
        } catch { /* non-fatal */ }
        // 2026-07-30 (Tim — "Serena has two speaking things racing… the old 'here when you're ready'
        // needs to go for all caddies, same flow for all"). setCaddiePersonality already fires the ONE
        // unified handoff (the per-persona bundled opener clip, in-character + zero-network). Speaking a
        // second ack here made it double-speak on the local-intent route. Return NO voice_response so the
        // bundled opener is the single handoff for every caddie.
        settings.setCaddiePersonality(v as Persona);
        return { success: true, voice_response: null, side_effects: ['caddie_persona:' + v], follow_up_needed: false };
      }

      // 2026-07-24 (final QA — "ask for settings"). Handedness was settable in Settings +
      // read by the swing analysis (resolveSwingerHandedness), but there was NO way to set it
      // by ASKING — a lefty couldn't turn on left-handed by voice even though the analysis
      // honors it. Sets the account-holder profile (the same field the analysis reads).
      case 'handedness':
      case 'left_handed':
      case 'lefty':
      case 'dominant_hand': {
        const raw = String(rawValue ?? '').toLowerCase();
        const hand: 'left' | 'right' | null =
          /\bleft|lefty|left-handed|southpaw\b/.test(raw) ? 'left' :
          /\bright|righty|right-handed\b/.test(raw) ? 'right' :
          // "turn on left-handed" arrives as setting=left_handed + value=on/true → left.
          (setting === 'left_handed' || setting === 'lefty') && asBool(rawValue) === true ? 'left' :
          (setting === 'left_handed' || setting === 'lefty') && asBool(rawValue) === false ? 'right' :
          null;
        if (hand === null) return clarify('Left-handed or right-handed?');
        usePlayerProfileStore.getState().setHandedness(hand);
        return ack(
          hand === 'left'
            ? "Set to left-handed — I'll mirror your guides and read your swing that way."
            : "Set to right-handed.",
          ['handedness:' + hand],
        );
      }

      // 2026-07-24 (final QA — "ask for settings"). Units (yards/meters) had a store setter
      // but no ask path, so a metric player couldn't switch by voice.
      case 'units':
      case 'distance_unit':
      case 'measurement': {
        const raw = String(rawValue ?? '').toLowerCase();
        const unit: 'yards' | 'meters' | null =
          /\bmeter|metre|metric\b/.test(raw) ? 'meters' :
          /\byard|imperial\b/.test(raw) ? 'yards' :
          null;
        if (unit === null) return clarify('Yards or meters?');
        useSettingsStore.getState().setDistanceUnit(unit);
        return ack(`Distances in ${unit} now.`, ['distance_unit:' + unit]);
      }

      // 2026-07-29 (audit — VOICE-F5) — SmartVision imagery toggle (satellite aerial vs static hole
      // photo) was tap-only. "show me the satellite / aerial view" → gps; "static / drawn / hole photo"
      // → curated; "auto / best" → auto. Setter: setSmartVisionImagery('curated'|'gps'|'auto').
      case 'imagery':
      case 'imagery_mode':
      case 'satellite_view':
      case 'map_view':
      case 'smartvision_imagery': {
        const raw = String(rawValue ?? setting).toLowerCase();
        const mode: 'curated' | 'gps' | 'auto' | null =
          /\b(satellite|aerial|sat|gps|real)\b/.test(raw) ? 'gps' :
          /\b(static|drawn|photo|curated|diagram|map)\b/.test(raw) ? 'curated' :
          /\b(auto|automatic|best|default)\b/.test(raw) ? 'auto' :
          null;
        if (mode === null) return clarify('Satellite view or the static hole photo?');
        useSettingsStore.getState().setSmartVisionImagery(mode);
        const label = mode === 'gps' ? 'satellite aerial' : mode === 'curated' ? 'the static hole photo' : 'auto (best available)';
        return ack(`SmartVision showing ${label} now.`, ['smartvision_imagery:' + mode]);
      }

      default:
        return {
          success: false,
          voice_response: 'Which setting — theme, voice, language, handedness, units, or response length?',
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
