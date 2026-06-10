import type { VoiceIntent, AppContext, IntentConfidence } from '../types/voiceIntent';
import type { Persona, VoiceGender } from '../lib/persona';
import { isDegraded, recordFailure, recordSuccess } from './voiceCircuitBreaker';

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

  // 2026-06-07 audit r6 — Circuit breaker short-circuit. If
  // /api/voice-intent has been hammered with failures recently,
  // skip the fetch entirely and return 'unknown'. The router will
  // route the resulting failure to localStatusResponder (also
  // shipped in r6) which may produce a useful templated answer.
  if (isDegraded('voice-intent')) {
    console.log('[voiceCommandParser] /api/voice-intent degraded — short-circuit');
    return failure(text);
  }
  try {
    const controller = new AbortController();
    // 2026-06-07 — Bumped 8s → 15s. The classifier runs on Anthropic
    // Haiku via Vercel Lambda — cold-start can exceed 8s on first
    // interaction even after voiceWarmup pings the SDK. Abort at 8s
    // was returning 'unknown' confidence:'low', falling through to
    // the brain — adding the full /api/kevin round-trip on top of
    // the already-slow classifier wait. 15s lets the classifier
    // finish cleanly on cold start; subsequent warm calls still
    // resolve in ~200-500ms.
    const timeout = setTimeout(() => controller.abort(), 15000);

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
      // 5xx/4xx is a server problem, not a connectivity loss — don't let it
      // auto-engage Local Mode / show "cell signal weak".
      recordFailure('voice-intent', 'server');
      return failure(text);
    }
    recordSuccess('voice-intent');

    const data = await res.json() as {
      intent_type?: string;
      parameters?: Record<string, unknown>;
      confidence?: string;
      follow_up_question?: string | null;
      language?: 'en' | 'es' | 'zh';
    };

    const confidence: IntentConfidence =
      data.confidence === 'high' || data.confidence === 'medium' || data.confidence === 'low'
        ? data.confidence
        : 'low';

    // 2026-05-24 — Classifier-detected utterance language ("cuántas yardas"
    // → es, "多少码" → zh). Carried on VoiceIntent so the router can
    // thread it into AppContext for localized voice_response strings.
    // Undefined when the classifier doesn't emit a value (older Vercel
    // route or unrecognized triggers) — handlers fall back to 'en'.
    const language: 'en' | 'es' | 'zh' | undefined =
      data.language === 'en' || data.language === 'es' || data.language === 'zh'
        ? data.language
        : undefined;

    return {
      intent_type: data.intent_type ?? 'unknown',
      parameters: data.parameters ?? {},
      confidence,
      follow_up_question: data.follow_up_question ?? null,
      raw_text: text,
      language,
    };

  } catch (err) {
    console.log('[voiceCommandParser] error:', err);
    // The 15s controller.abort() above fires an AbortError on a slow classifier
    // — that's server slowness, not a dead network. Only a genuine network
    // throw should count as 'network' (the kind that flips Local Mode).
    const name = err instanceof Error ? err.name : '';
    const aborted = name === 'AbortError' || name === 'TimeoutError';
    recordFailure('voice-intent', aborted ? 'timeout' : 'network');
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
