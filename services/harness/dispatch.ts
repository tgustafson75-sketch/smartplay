/**
 * Scenario harness — dispatch wrapper.
 *
 * Thin helpers that let scenarios drive the production voice-intent
 * pipeline (services/voiceCommandRouter.ts) without going through ASR
 * or the classifier. We build a VoiceIntent object directly with high
 * confidence + raw_text equal to a synthetic transcript, then dispatch
 * it. The router runs the same handler chain the live app uses; the
 * IntentResult comes back exactly as a real voice path would produce.
 *
 * Also provides simulateAnalysisCompletion: a helper that flips
 * perShotAnalysis on a seeded cage shot to model the post-record
 * Phase K async return.
 *
 * 2026-05-24 — Built per the harness expansion sketch.
 */

import { voiceCommandRouter } from '../intents';
import type { VoiceIntent, AppContext, IntentResult } from '../../types/voiceIntent';
import { useRoundStore } from '../../store/roundStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useTrustLevelStore } from '../../store/trustLevelStore';
import { useCageStore } from '../../store/cageStore';

/** Build an AppContext snapshot from current store state. Matches the
 *  shape voiceCommandRouter callers in the live app construct. */
export function buildAppContext(overrides?: Partial<AppContext>): AppContext {
  const round = useRoundStore.getState();
  const settings = useSettingsStore.getState();
  const trust = useTrustLevelStore.getState();
  const base: AppContext = {
    active_screen: 'harness',
    active_round: round.isRoundActive
      ? {
          course: round.activeCourse,
          mode: round.mode,
          holesPlayed: round.getHolesPlayed?.() ?? 0,
          totalScore: round.getTotalScore?.() ?? 0,
          scoreVsPar: round.getScoreVsPar?.() ?? 0,
        }
      : null,
    current_hole: round.currentHole ?? null,
    recent_shots: round.shots.slice(-5),
    trust_spectrum_level: trust.level,
    language: settings.language,
  };
  return { ...base, ...overrides };
}

/**
 * Dispatch a synthetic VoiceIntent through the production router.
 * Bypasses ASR + classifier — handlers themselves are exercised as in
 * production. Returns the same IntentResult shape.
 */
export async function dispatchVoiceIntent(opts: {
  intent_type: string;
  parameters?: Record<string, unknown>;
  raw_text?: string;
  language?: 'en' | 'es' | 'zh';
  contextOverrides?: Partial<AppContext>;
}): Promise<IntentResult> {
  const intent: VoiceIntent = {
    intent_type: opts.intent_type,
    parameters: opts.parameters ?? {},
    confidence: 'high',
    follow_up_question: null,
    raw_text: opts.raw_text ?? `[harness] ${opts.intent_type}`,
    ...(opts.language ? { language: opts.language } : {}),
  };
  const ctx = buildAppContext(opts.contextOverrides);
  return await voiceCommandRouter.dispatch(intent, ctx);
}

/**
 * Simulate the async return of the Phase K per-shot analyzer.
 * Equivalent to what services/swingAnalysisPipeline produces after a
 * record-and-analyze round trip; scenarios use this to verify that
 * downstream UI / subscribers (feel capture, primary-issue card render)
 * react to the perShotAnalysis flip.
 */
export function simulateAnalysisCompletion(opts: {
  sessionId: string;
  shotId: string;
  analysis: {
    detected_issue: string;
    severity: 'minor' | 'moderate' | 'significant' | 'none';
    confidence: 'high' | 'medium' | 'low';
    observation: string;
    fault_frame_index?: number;
    visual_reference_path?: string | null;
  };
}): void {
  useCageStore.getState().setShotAnalysis(opts.sessionId, opts.shotId, opts.analysis);
}
