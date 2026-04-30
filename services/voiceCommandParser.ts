import type { VoiceIntent, AppContext, IntentConfidence } from '../types/voiceIntent';

export async function parseVoiceIntent(
  text: string,
  context: AppContext,
  apiUrl: string,
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

    const res = await fetch(apiUrl + '/api/voice-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ text: trimmed, context }),
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
