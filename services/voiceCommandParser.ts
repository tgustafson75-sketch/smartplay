import type { VoiceIntent, AppContext, IntentConfidence } from '../types/voiceIntent';
import type { Persona, VoiceGender } from '../lib/persona';

export async function parseVoiceIntent(
  text: string,
  context: AppContext,
  apiUrl: string,
  voiceGender: VoiceGender = 'male',
  persona?: Persona,
): Promise<VoiceIntent> {
  const trimmed = text.trim();

  if (!trimmed) {
    return {
      intent_type: 'unknown',
      parameters: {},
      confidence: 'low',
      follow_up_question: null,
      raw_text: text,
    };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    // 2026-05-21 — Fix Q: pass persona so the classifier's follow-up
    // question (when emitted) is styled in the active caddie's voice.
    // If the caller didn't pass persona explicitly, fall back to the
    // global selection at request time. Dynamic require avoids a circular
    // store import for callers (e.g. voice-debug) that don't already have
    // settings in scope.
    let resolvedPersona: Persona | undefined = persona;
    if (!resolvedPersona) {
      try {
        const settingsMod = require('../store/settingsStore');
        resolvedPersona = settingsMod.useSettingsStore.getState().caddiePersonality as Persona;
      } catch { /* ignore — server will default */ }
    }

    const res = await fetch(apiUrl + '/api/voice-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ text: trimmed, context, voiceGender, persona: resolvedPersona }),
    }).finally(() => clearTimeout(timeout));

    if (!res.ok) {
      return failure(text);
    }

    const data = await res.json() as {
      intent_type?: string;
      parameters?: Record<string, unknown>;
      confidence?: string;
      follow_up_question?: string | null;
    };

    const confidence: IntentConfidence =
      data.confidence === 'high' || data.confidence === 'medium' || data.confidence === 'low'
        ? data.confidence
        : 'low';

    return {
      intent_type: data.intent_type ?? 'unknown',
      parameters: data.parameters ?? {},
      confidence,
      follow_up_question: data.follow_up_question ?? null,
      raw_text: text,
    };

  } catch (err) {
    console.log('[voiceCommandParser] error:', err);
    return failure(text);
  }
}

function failure(text: string): VoiceIntent {
  return {
    intent_type: 'unknown',
    parameters: {},
    confidence: 'low',
    follow_up_question: null,
    raw_text: text,
  };
}
