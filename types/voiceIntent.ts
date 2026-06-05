import type { ShotResult } from '../store/roundStore';
import type { ToolAction } from '../app/api/kevin+api';

export type IntentConfidence = 'high' | 'medium' | 'low';

export interface VoiceIntent {
  intent_type: string;
  parameters: Record<string, unknown>;
  confidence: IntentConfidence;
  follow_up_question: string | null;
  raw_text: string;
  language?: 'en' | 'es' | 'zh';
}

export interface AppContext {
  active_screen: string;
  active_round: {
    course: string | null;
    mode: string;
    holesPlayed: number;
    totalScore: number;
    scoreVsPar: number;
  } | null;
  current_hole: number | null;
  recent_shots: ShotResult[];
  trust_spectrum_level: 1 | 2 | 3;
  language?: 'en' | 'es' | 'zh';
}

export interface IntentResult {
  success: boolean;
  voice_response: string | null;
  side_effects: string[];
  follow_up_needed: boolean;
  tool_action?: ToolAction | null;
}

export interface IntentHandler {
  intent_type: string;
  parameter_schema: Record<string, string>;
  examples: string[];
  execute: (intent: VoiceIntent, context: AppContext) => Promise<IntentResult>;
}
