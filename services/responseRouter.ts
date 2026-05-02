/**
 * Phase P — Response Router
 *
 * Single source of truth for "given an intent + context, what kind of
 * response generation will it use, and should we play a filler clip
 * during the gap?"
 *
 * Today's routing is documented in docs/voice-routing.md. The
 * conversation loop in services/listeningSession.ts only ever calls
 * direct handlers (synchronous) gated by a Haiku intent classifier.
 * Out-of-band Sonnet calls (lie analysis, swing analysis) live on
 * their own UI surfaces and bridge with their own filler firings.
 *
 * The router exists so future model migrations have one place to live:
 * when Tank ships, when Haiku 5 lands, when streaming TTS replaces
 * batch TTS, the per-intent decision moves here, not into every
 * consumer site.
 */

import type { FillerCategory } from '../types/filler';

export type ResponseHandler = 'direct' | 'haiku' | 'sonnet';
export type ResponsePriority = 'fast' | 'standard' | 'deep';

export interface RouteDecision {
  handler: ResponseHandler;
  priority: ResponsePriority;
  /** Filler category to play during the gap (null = no filler). */
  filler: FillerCategory | null;
  /** Threshold in ms above which a filler should fire even on direct paths. */
  filler_threshold_ms: number;
}

export interface RouteContext {
  /** Active surface inferred role: caddie, coach, psychologist. */
  role?: 'caddie' | 'coach' | 'psychologist';
  /** Trust spectrum 1-4 — affects filler verbosity. */
  trust_level?: 1 | 2 | 3 | 4;
  /** Optional intent sub-topic (query_topic for query_status, etc.). */
  topic?: string | null;
}

const DEFAULT_THRESHOLD_MS = 800;

/**
 * Decide routing for a classified intent.
 * Mirrors the table in docs/voice-routing.md — keep in sync.
 */
export function routeQuery(intent_type: string, ctx: RouteContext = {}): RouteDecision {
  const role = ctx.role ?? 'caddie';
  const topic = ctx.topic ?? null;

  switch (intent_type) {
    case 'query_status':
      return {
        handler: 'direct',
        priority: 'fast',
        filler: topic === 'ghost' ? 'ghost' : null,
        filler_threshold_ms: DEFAULT_THRESHOLD_MS,
      };

    case 'open_tool':
      // Tool nav is instant; if the tool itself triggers Sonnet (lie analysis),
      // the tool surface fires its own filler.
      return {
        handler: 'direct',
        priority: 'fast',
        filler: topic === 'lie_analysis' ? 'looking' : 'confirming',
        filler_threshold_ms: 1200,
      };

    case 'change_setting':
    case 'navigate':
      return {
        handler: 'direct',
        priority: 'fast',
        filler: 'confirming',
        filler_threshold_ms: 1200,
      };

    case 'acknowledge':
      return {
        handler: 'direct',
        priority: 'fast',
        filler: 'acknowledging',
        filler_threshold_ms: DEFAULT_THRESHOLD_MS,
      };

    case 'help':
      return {
        handler: 'direct',
        priority: 'standard',
        filler: null,
        filler_threshold_ms: DEFAULT_THRESHOLD_MS,
      };

    case 'unknown':
      // Future: route to /api/kevin Haiku branch. Today: brief acknowledgment.
      return {
        handler: 'haiku',
        priority: 'standard',
        filler: 'acknowledging',
        filler_threshold_ms: 600,
      };

    default:
      // Unknown intent_type — be defensive, log via fallthrough handler.
      return {
        handler: 'direct',
        priority: 'standard',
        filler: role === 'coach' ? 'engaging' : role === 'psychologist' ? 'casual' : null,
        filler_threshold_ms: DEFAULT_THRESHOLD_MS,
      };
  }
}

/**
 * For out-of-band Sonnet vision calls (lie analysis, swing analysis,
 * cv-scoring), the consumer site asks the router which filler to play
 * while the request is in flight. Centralised here so all Sonnet bridges
 * share the same filler vocabulary.
 */
export function fillerForSonnetVision(kind: 'lie' | 'swing' | 'cv_scoring' | 'course_content' | 'recap' | 'briefing'): FillerCategory {
  switch (kind) {
    case 'lie':            return 'looking';
    case 'swing':          return 'analyzing';
    case 'cv_scoring':     return 'looking';
    case 'course_content': return 'thinking';
    case 'recap':          return 'analyzing';
    case 'briefing':       return 'thinking';
  }
}
