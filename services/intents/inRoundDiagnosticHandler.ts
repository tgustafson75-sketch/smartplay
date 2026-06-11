/**
 * 2026-05-26 — Fix BR: in-round diagnostic intent handler.
 *
 * The voice-intent classifier emits `in_round_diagnostic` when the
 * user describes a multi-shot pattern AND asks WHY ("irons fine but
 * driver going right hard, why?"). Without a registered handler the
 * dispatcher previously returned the canned "I can't do that yet"
 * — even though the brain endpoint already has a coach-diagnostic
 * mode that's exactly what this intent wants.
 *
 * This handler bridges the gap: forwards the pattern + intent flag
 * to /api/kevin with `register: 'coach'` + `inRoundDiagnostic: true`
 * so kevin.ts:
 *   - Forces tier = CONVERSATIONAL (Sonnet) for reasoning
 *   - Injects the in-round diagnostic system prompt block
 *   - Returns a multi-sentence coaching reply (vs the tight tactical
 *     2-sentence default)
 *
 * Returns the brain's reply as voice_response so the caller speaks
 * it through the normal TTS pipeline.
 *
 * Side note: wants_card param (visual display) is captured but not
 * acted on yet — would require a card-rendering route. Logged as a
 * side_effect tag for owner debug.
 */

import type { IntentHandler, IntentResult, VoiceIntent, AppContext } from '../../types/voiceIntent';
import { getApiBaseUrl } from '../apiBase';

const apiUrl = getApiBaseUrl();

export const inRoundDiagnosticHandler: IntentHandler = {
  intent_type: 'in_round_diagnostic',
  parameter_schema: {
    pattern_text: 'verbatim summary of the pattern the user described',
    wants_card: 'optional bool — true for visual card, default false (voice response)',
  },
  examples: [
    "irons flushing but driver going right hard, what's wrong",
    'why am I slicing my long clubs but my wedges are fine',
    "what's going on with my swing today",
  ],
  execute: async (intent: VoiceIntent, ctx: AppContext): Promise<IntentResult> => {
    const params = (intent.parameters ?? {}) as { pattern_text?: string; wants_card?: boolean };
    const patternText = typeof params.pattern_text === 'string' ? params.pattern_text.trim() : '';
    const wantsCard = params.wants_card === true;

    if (!patternText) {
      // Defensive: classifier should always emit pattern_text but if it
      // doesn't, fall through to the brain with the raw transcript.
      // Don't return a canned reply — that's the silent-failure path.
      return {
        success: false,
        voice_response: null,
        side_effects: ['in_round_diagnostic:no_pattern_text'],
        follow_up_needed: false,
      };
    }

    try {
      // Keep this call path persona-safe: if we omit persona, /api/kevin
      // falls back to legacy gender defaults and can drift to Kevin's voice.
      let persona: 'kevin' | 'serena' | 'harry' | 'tank' | 'custom' = 'kevin';
      let voiceGender: 'male' | 'female' = 'male';
      let personaIntensity = 100;
      let tankSoftIntro = false;
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const settings = require('../../store/settingsStore') as typeof import('../../store/settingsStore');
        const s = settings.useSettingsStore.getState();
        persona = s.caddiePersonality;
        voiceGender = s.voiceGender;
        personaIntensity = s.personaIntensity?.[s.caddiePersonality] ?? 100;
        tankSoftIntro = s.tankSoftIntro;
      } catch {
        // Non-fatal: defaults keep behavior stable if store is unavailable.
      }

      // 2026-05-26 — Brain call shape: pull the SAME envelope shape
      // hooks/useVoiceCaddie.ts:sendToBrain assembles (context blocks +
      // persona) BUT with the in-round-diagnostic flags set. We can't
      // import sendToBrain here without dragging React deps, so this
      // handler sends a minimal envelope that lets api/kevin compose
      // the prompt; richer per-shot context comes from later turns.
      // The brain's stateful conversation buffer (Phase AR) carries
      // recent shot context across turns so the diagnostic call has
      // grounding from the prior caddie chatter.
      const payload = {
        message: patternText,
        language: ctx.language ?? 'en',
        register: 'coach',
        inRoundDiagnostic: true,
        // is_proactive false because the user explicitly asked
        is_proactive: false,
        voiceGender,
        persona,
        personaIntensity,
        tankSoftIntro,
      };
      const res = await fetch(`${apiUrl}/api/kevin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        return {
          success: false,
          voice_response: 'I tried to dig into that and hit a snag — try once more?',
          side_effects: [`in_round_diagnostic:http_${res.status}`],
          follow_up_needed: false,
        };
      }
      const data = await res.json() as { text?: string };
      const reply = (data.text ?? '').trim();
      if (!reply) {
        return {
          success: false,
          voice_response: "Couldn't pin a single cause from what you described — say a bit more about which shot you're hitting?",
          side_effects: ['in_round_diagnostic:empty_reply'],
          follow_up_needed: true,
        };
      }
      return {
        success: true,
        voice_response: reply,
        side_effects: ['in_round_diagnostic:answered', ...(wantsCard ? ['in_round_diagnostic:wants_card_unsupported'] : [])],
        follow_up_needed: false,
      };
    } catch (e) {
      console.log('[inRoundDiagnostic] brain call threw:', e);
      return {
        success: false,
        voice_response: 'Lost the connection on that one. Try again in a sec.',
        side_effects: ['in_round_diagnostic:exception'],
        follow_up_needed: false,
      };
    }
  },
};
