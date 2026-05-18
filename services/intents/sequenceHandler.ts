/**
 * 2026-05-17 — Chained-intent handler.
 *
 * Tim's ask: "tell Kevin I'm on hole 7, refresh GPS at the tee box on
 * hole 7" — one utterance that should fire two distinct actions
 * (change_setting currentHole=7 + a refresh-gps action). The classifier
 * already handles single intents cleanly; the cheapest extension is
 * to let it emit a `sequence` meta-intent whose parameters contain an
 * ordered list of step intents, then dispatch each step through the
 * normal router.
 *
 * Server-side prompt is updated to recognize chained utterances and
 * emit `{ intent_type: "sequence", parameters: { steps: [{...}, ...] }}`.
 *
 * The handler imports the router lazily to avoid a circular dependency
 * (services/intents/index.ts → registers handlers → handlers can't
 * import router at module-load time without a cycle). Lazy import
 * happens at execute() time when the cycle is already resolved.
 */

import type {
  IntentHandler,
  IntentResult,
  VoiceIntent,
  AppContext,
  IntentConfidence,
} from '../../types/voiceIntent';

interface SequenceStep {
  intent_type?: string;
  parameters?: Record<string, unknown>;
  confidence?: string;
}

export const sequenceHandler: IntentHandler = {
  intent_type: 'sequence',

  parameter_schema: {
    steps: 'array of { intent_type, parameters } — executed in order',
  },

  examples: [
    "tell Kevin I'm on hole 7, refresh GPS at the tee box",
    'log a 5 on this hole and move to the next tee',
    'open SmartFinder and switch to quiet mode',
  ],

  async execute(intent: VoiceIntent, context: AppContext): Promise<IntentResult> {
    const rawSteps = (intent.parameters as { steps?: unknown }).steps;
    if (!Array.isArray(rawSteps) || rawSteps.length === 0) {
      return {
        success: false,
        voice_response: "I caught a chain but no steps — say it again?",
        side_effects: ['sequence:empty'],
        follow_up_needed: true,
      };
    }

    // Lazy import to break the circular dep between this handler and
    // the router that owns it.
    const { voiceCommandRouter } = await import('./index');

    const responses: string[] = [];
    const sideEffects: string[] = [];
    let allOk = true;

    for (let i = 0; i < rawSteps.length; i++) {
      const step = rawSteps[i] as SequenceStep;
      const stepIntent: VoiceIntent = {
        intent_type: step.intent_type ?? 'unknown',
        parameters: (step.parameters as Record<string, unknown>) ?? {},
        confidence: (step.confidence === 'high' || step.confidence === 'medium' || step.confidence === 'low'
          ? step.confidence
          : 'medium') as IntentConfidence,
        follow_up_question: null,
        raw_text: intent.raw_text,
      };

      try {
        const result = await voiceCommandRouter.dispatch(stepIntent, context);
        if (result.voice_response) responses.push(result.voice_response);
        if (Array.isArray(result.side_effects)) {
          sideEffects.push(...result.side_effects.map((s) => `seq[${i}]:${s}`));
        }
        if (!result.success) allOk = false;
      } catch (e) {
        console.log('[sequenceHandler] step', i, 'threw:', e);
        sideEffects.push(`seq[${i}]:error`);
        allOk = false;
      }
    }

    // Stitch responses with a brief pause between thoughts — single
    // sentence flow when 1 response, sentence-break when multiple.
    const combined = responses.filter(Boolean).join(' ');

    return {
      success: allOk,
      voice_response: combined || null,
      side_effects: ['sequence:' + rawSteps.length, ...sideEffects],
      follow_up_needed: false,
    };
  },
};
