import type { VoiceIntent, AppContext, IntentHandler, IntentResult } from '../types/voiceIntent';
import { parseVoiceIntent } from './voiceCommandParser';
import { useVoiceMissStore, type VoiceMissType } from '../store/voiceMissStore';
import { getActiveSurface } from './activeSurfaceRegistry';
import { precheckLocalIntent } from './localIntentPrecheck';
import { useAgentBrainStats } from '../store/agentBrainStats';

export interface RoutingLog {
  timestamp: number;
  raw_text: string;
  parsed_intent: VoiceIntent;
  result: IntentResult;
}

// 2026-06-13 — Classifier alias. The intent classifier sometimes emits an
// open_tool TOOL NAME as the top-level intent_type (e.g. "mark_green" for odd
// phrasings like "Yes, mark that I'm on the center of the green") instead of
// intent_type:'open_tool' + tool_name. The router only has a handler keyed on
// 'open_tool', so those fell through to "no handler wired" — Tim's Lakes round
// couldn't mark the green. Re-route any of these intent_types to open_tool with
// the tool_name set, so they actually fire.
const OPEN_TOOL_ALIAS_INTENTS = new Set<string>([
  'mark_green', 'markgreen', 'mark_tee', 'marktee', 'mark_tee_box',
  'smartvision', 'smartfinder', 'swinglab', 'scorecard', 'smartmotion',
  'coach_mode', 'coachmode', 'issue_log', 'issuelog',
]);

export class VoiceCommandRouter {
  private handlers: Map<string, IntentHandler> = new Map();
  private history: RoutingLog[] = [];
  private readonly MAX_HISTORY = 30;

  registerHandler(handler: IntentHandler): void {
    this.handlers.set(handler.intent_type, handler);
  }

  getRegisteredHandlers(): IntentHandler[] {
    return Array.from(this.handlers.values());
  }

  getHandler(intent_type: string): IntentHandler | undefined {
    return this.handlers.get(intent_type);
  }

  getHistory(): RoutingLog[] {
    return [...this.history];
  }

  clearHistory(): void {
    this.history = [];
  }

  async parse(text: string, context: AppContext, apiUrl: string): Promise<VoiceIntent> {
    return parseVoiceIntent(text, context, apiUrl);
  }

  async route(text: string, context: AppContext, apiUrl: string): Promise<{ intent: VoiceIntent; result: IntentResult }> {
    // 2026-06-06 — Local pre-classifier (services/localIntentPrecheck.ts).
    // High-frequency unambiguous phrases ("what's my score", "yards to
    // pin", "open SmartFinder") match here and skip the 200-500ms
    // Haiku classifier round-trip + $0.0005 cost. On no match → null
    // → fall through to cloud parse as today. Zero regression risk:
    // if precheck is wrong, the handler still produces a correct
    // local answer (Phase 3 localStatusResponder proved the patterns).
    const localIntent = precheckLocalIntent(text);
    // Self-growing-agent telemetry: precheck match = answered locally (0 tokens);
    // a miss escalates to the cloud classifier. The local hit-rate should climb
    // as the brain grows. (self-growing-agent-architecture)
    try {
      if (localIntent) useAgentBrainStats.getState().noteLocal();
      else useAgentBrainStats.getState().noteCloud();
    } catch { /* telemetry is best-effort, never blocks routing */ }
    const intent = localIntent ?? await this.parse(text, context, apiUrl);
    const result = await this.dispatch(intent, context);
    this.recordHistory(intent, result);
    return { intent, result };
  }

  async dispatch(intent: VoiceIntent, context: AppContext): Promise<IntentResult> {
    // 2026-06-04 — `conversational` falls through to the brain (free-form
    // questions need the LLM). Does not log to voice-miss (intentional).
    // 2026-06-06 — `social_greeting` NO LONGER routes to brain; it falls
    // through to the new socialGreetingHandler below. The handler picks a
    // canned per-persona line and returns it as a normal IntentResult.
    // Brain is never called for greetings — saves the most expensive
    // round-trip on the most predictable utterance.
    if (intent.intent_type === 'conversational') {
      return {
        success: false,
        voice_response: null,
        side_effects: ['route_to_brain:' + intent.intent_type],
        follow_up_needed: false,
      };
    }
    if (intent.intent_type === 'unknown' || intent.confidence === 'low') {
      // 2026-06-07 audit r6 — CRITICAL offline-resilience gap fix:
      // before falling through to brain, try the local-status
      // responder. The classifier returns 'unknown' / low-confidence
      // for TWO different reasons:
      //   (a) The transcript was genuinely free-form (real "ask the
      //       brain" content) → fall through to brain (current).
      //   (b) The /api/voice-intent fetch FAILED (no cell) →
      //       voiceCommandParser.failure() returns {unknown, low}.
      //       Previously this produced "I can't do that yet, but I
      //       will soon." even when localStatusResponder would have
      //       answered (yardage / score / hole / par / etc.). The
      //       offline-resilience audit (Echo Hills 28-strike scenario)
      //       called this out as user-hostile.
      // Try local responder first; if it matches, return its templated
      // answer. If null (no pattern match), preserve the existing
      // brain-fallback path.
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const responder = require('./localStatusResponder') as typeof import('./localStatusResponder');
        const langSafe = context.language && (['en', 'es', 'zh'] as const).includes(context.language as 'en' | 'es' | 'zh')
          ? (context.language as 'en' | 'es' | 'zh')
          : 'en';
        const local = responder.tryLocalReply(intent.raw_text, langSafe);
        if (local) {
          // Self-growing metric: this query was first counted as cloud (precheck
          // missed), but the memory-backed responder answered it locally — reclassify
          // so localHitRate reflects CNS growth, not just the static precheck.
          try { useAgentBrainStats.getState().reclassifyCloudToLocal(); } catch { /* best-effort */ }
          return {
            success: true,
            voice_response: local.text,
            side_effects: ['local_responder_classifier_fallback:' + local.queryType],
            follow_up_needed: false,
          };
        }
      } catch (e) {
        console.log('[voiceCommandRouter] localStatusResponder threw (non-fatal):', e);
      }
      // Conversational fallbacks are intentionally routed to Kevin's brain
      // and should not clutter the owner's miss log. Only log the case when
      // the classifier asked for clarification, because that is a real UX gap
      // the owner can act on.
      if (intent.follow_up_question) {
        logVoiceMiss({
          transcript: intent.raw_text,
          missType: 'classifier_unknown',
          intent_type: null,
          error_message: null,
        });
      }
      return {
        success: false,
        voice_response: intent.follow_up_question ?? null,
        side_effects: ['unknown_or_low_confidence'],
        follow_up_needed: !!intent.follow_up_question,
      };
    }

    let handler = this.handlers.get(intent.intent_type);
    // Alias a tool-name intent_type to the open_tool handler (see note above).
    if (!handler && OPEN_TOOL_ALIAS_INTENTS.has(intent.intent_type)) {
      const openTool = this.handlers.get('open_tool');
      if (openTool) {
        handler = openTool;
        if (!intent.parameters.tool_name) {
          intent.parameters = { ...intent.parameters, tool_name: intent.intent_type };
        }
      }
    }
    if (!handler) {
      logVoiceMiss({
        transcript: intent.raw_text,
        missType: 'no_handler',
        intent_type: intent.intent_type,
        error_message: null,
      });
      return {
        success: false,
        voice_response: 'I can\'t do that yet, but I will soon.',
        side_effects: ['no_handler:' + intent.intent_type],
        follow_up_needed: false,
      };
    }

    try {
      // 2026-05-24 — Thread classifier-detected utterance language into
      // AppContext so handlers can localize voice_response without a
      // Settings change. Detection happens in api/voice-intent.ts based
      // on transcript triggers ("cuántas yardas" → es, "多少码" → zh).
      // Falls through unchanged when intent.language is undefined.
      const ctx: AppContext = intent.language ? { ...context, language: intent.language } : context;
      return await handler.execute(intent, ctx);
    } catch (err) {
      console.log('[voiceCommandRouter] handler error:', err);
      logVoiceMiss({
        transcript: intent.raw_text,
        missType: 'handler_error',
        intent_type: intent.intent_type,
        error_message: err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300),
      });
      return {
        success: false,
        voice_response: 'Hit a snag on that one. Try again?',
        side_effects: ['handler_error:' + intent.intent_type],
        follow_up_needed: false,
      };
    }
  }

  private recordHistory(intent: VoiceIntent, result: IntentResult): void {
    this.history.push({
      timestamp: Date.now(),
      raw_text: intent.raw_text,
      parsed_intent: intent,
      result,
    });
    if (this.history.length > this.MAX_HISTORY) {
      this.history = this.history.slice(-this.MAX_HISTORY);
    }
  }
}

/**
 * Capture an unrecognized / failed voice command for owner review.
 * Pulls persona / round-state context lazily so the router stays
 * dependency-light. Best-effort — wrapped in try so a logging failure
 * never breaks the user's voice loop.
 *
 * The user's spoken fallback (the honest "I didn't catch that" / "I
 * can't do that yet" / "Hit a snag") is produced by dispatch() before
 * this fires — logging is purely behind-the-scenes telemetry.
 */
function logVoiceMiss(args: {
  transcript: string;
  missType: VoiceMissType;
  intent_type: string | null;
  error_message: string | null;
}): void {
  try {
    let persona: string | null = null;
    let isRoundActive = false;
    let currentHole: number | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const settings = require('../store/settingsStore') as typeof import('../store/settingsStore');
      persona = settings.useSettingsStore.getState().caddiePersonality ?? null;
    } catch { /* settings store not available — leave null */ }
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const round = require('../store/roundStore') as typeof import('../store/roundStore');
      const r = round.useRoundStore.getState();
      isRoundActive = !!r.isRoundActive;
      currentHole = isRoundActive ? r.currentHole : null;
    } catch { /* round store not available — leave defaults */ }

    let surface: string | null = null;
    try {
      surface = getActiveSurface();
    } catch { /* registry not available — leave null */ }

    useVoiceMissStore.getState().addMiss({
      transcript: args.transcript,
      missType: args.missType,
      intent_type: args.intent_type,
      error_message: args.error_message,
      surface,
      context: { persona, isRoundActive, currentHole },
    });
  } catch (e) {
    console.log('[voiceCommandRouter] logVoiceMiss failed (non-fatal):', e);
  }
}
