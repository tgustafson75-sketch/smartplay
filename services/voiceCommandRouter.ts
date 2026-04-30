import type { VoiceIntent, AppContext, IntentHandler, IntentResult } from '../types/voiceIntent';
import { parseVoiceIntent } from './voiceCommandParser';

export interface RoutingLog {
  timestamp: number;
  raw_text: string;
  parsed_intent: VoiceIntent;
  result: IntentResult;
}

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
    const intent = await this.parse(text, context, apiUrl);
    const result = await this.dispatch(intent, context);
    this.recordHistory(intent, result);
    return { intent, result };
  }

  async dispatch(intent: VoiceIntent, context: AppContext): Promise<IntentResult> {
    if (intent.intent_type === 'unknown' || intent.confidence === 'low') {
      return {
        success: false,
        voice_response: intent.follow_up_question ?? null,
        side_effects: ['unknown_or_low_confidence'],
        follow_up_needed: !!intent.follow_up_question,
      };
    }

    const handler = this.handlers.get(intent.intent_type);
    if (!handler) {
      return {
        success: false,
        voice_response: 'I can\'t do that yet, but I will soon.',
        side_effects: ['no_handler:' + intent.intent_type],
        follow_up_needed: false,
      };
    }

    try {
      return await handler.execute(intent, context);
    } catch (err) {
      console.log('[voiceCommandRouter] handler error:', err);
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
