import type { LieAnalysisContext } from './lieAnalysisContext';
import * as Sentry from '@sentry/react-native';
import { bumpToActive } from './gpsManager';

/**
 * Phase H — client-side fetcher for the lie-analysis endpoint.
 *
 * Returns the full analysis payload on success, or a typed error result the
 * UI can render directly (no-network → "save for later" flow; failures →
 * "try again" affordance). Never throws — surfaces all failure modes as
 * structured results.
 */

export type LieAnalysis = {
  situation_description: string;
  tactical_advice: string;
  recommended_club: string | null;
  alternative_play: string | null;
  confidence_level: 'high' | 'medium' | 'low';
  conservative_call: boolean;
  follow_up_question?: string | null;
  // Phase H v2 — populated only when goal context affected the call.
  goal_aware_note?: string | null;
};

export type LieAnalysisResult =
  | { kind: 'ok'; analysis: LieAnalysis }
  | { kind: 'no_network' }
  | { kind: 'too_large' }
  | { kind: 'low_quality'; follow_up: string }
  | { kind: 'error'; message: string };

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Pre-beta — single-flight controller for Sonnet vision calls. Cancel-and-
 * replace policy: a newer analyze() aborts the in-flight one. Newer request
 * reflects newer user intent. Cancellations log a Sentry breadcrumb so we
 * can see if users are firing too many in a row.
 */
class VisionRequestController {
  private currentRequest: AbortController | null = null;
  private listeners = new Set<(active: boolean) => void>();

  subscribe(cb: (active: boolean) => void): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  isActive(): boolean {
    return this.currentRequest !== null;
  }

  beginNew(): AbortController {
    if (this.currentRequest) {
      this.currentRequest.abort();
      try { Sentry.addBreadcrumb({ category: 'vision', level: 'info', message: 'cancel_replace' }); } catch {}
      console.log('[vision] cancel-and-replace');
    }
    const ctrl = new AbortController();
    this.currentRequest = ctrl;
    this.notify(true);
    return ctrl;
  }

  end(ctrl: AbortController | null): void {
    if (ctrl && this.currentRequest === ctrl) {
      this.currentRequest = null;
      this.notify(false);
    }
  }

  private notify(active: boolean): void {
    for (const cb of this.listeners) {
      try { cb(active); } catch {}
    }
  }
}

const visionController = new VisionRequestController();

export const subscribeVisionActive = (cb: (active: boolean) => void): (() => void) =>
  visionController.subscribe(cb);

export const isVisionActive = (): boolean => visionController.isActive();

export async function analyzeLie(
  imageBase64: string,
  context: LieAnalysisContext,
  imageMediaType: 'image/jpeg' | 'image/png' = 'image/jpeg',
  voiceGender: 'male' | 'female' = 'male',
): Promise<LieAnalysisResult> {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';

  // Lie analysis tap is a shot-intent signal — bump GPS to active.
  try { bumpToActive('lie_analysis'); } catch {}

  // Cancel any in-flight vision request and start a new one. The
  // controller returned here is OUR controller; visionController.end(it)
  // is a no-op if a newer request has since claimed the slot.
  const myController = visionController.beginNew();

  try {
    const timeoutId = setTimeout(() => myController.abort(), REQUEST_TIMEOUT_MS);
    // 2026-05-22 — Fix Q follow-up audit. lieAnalysisService was sending
    // voiceGender only; backend resolvePersona(voiceGender) fell back to
    // Kevin for non-Serena even when Serena/Tank was selected. Threading
    // persona now closes that silent bleed.
    let _persona: 'kevin' | 'serena' | 'harry' | 'tank' | undefined;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('../store/settingsStore') as typeof import('../store/settingsStore');
      _persona = mod.useSettingsStore.getState().caddiePersonality;
    } catch { /* fall through to voiceGender on backend */ }
    const res = await fetch(`${apiUrl}/api/lie-analysis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_b64: imageBase64,
        image_media_type: imageMediaType,
        context,
        voiceGender,
        persona: _persona,
      }),
      signal: myController.signal,
    }).finally(() => clearTimeout(timeoutId));

    if (res.status === 413) return { kind: 'too_large' };
    if (!res.ok) {
      return { kind: 'error', message: `Server returned ${res.status}` };
    }

    const data = (await res.json()) as LieAnalysis;

    // Low-confidence + follow_up_question = the model couldn't read the
    // image. Surface as low_quality so the UI prompts a retry rather than
    // speaking iffy advice aloud.
    if (data.confidence_level === 'low' && data.follow_up_question) {
      return { kind: 'low_quality', follow_up: data.follow_up_question };
    }

    return { kind: 'ok', analysis: data };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/network|abort|timeout|fetch/i.test(msg)) {
      return { kind: 'no_network' };
    }
    return { kind: 'error', message: msg };
  } finally {
    visionController.end(myController);
  }
}

// ─── 2026-05-22 — Enriched lie analysis ────────────────────────────────
//
// Higher-level wrapper that folds in adjacent signals the base
// analyzeLie() doesn't have visibility into:
//   - Acoustic strike data from the player's last shot (if captured) —
//     informs turf quality + suggests realistic spin / launch range
//   - Strategic risk/reward overlay derived from metaCourseIntelligence
//     so the recommendation isn't just "what's possible" but "what's
//     SMART given the hole + ghost + miss bias"
//
// All side signals are OPTIONAL. With only the vision result it returns
// the base analysis untouched; with everything it returns a richer
// EnrichedLieAnalysis the caller can render as multiple cards.

export interface AcousticPriorSignal {
  /** Strike location from the player's most recent shot. */
  strike: 'flush' | 'fat' | 'thin' | 'heel' | 'toe' | 'unknown';
  /** Turf the club brushed through. */
  turf: 'grass' | 'sand' | 'hardpan' | 'rough' | 'unknown';
  /** 0..100 acoustic-classifier confidence. */
  confidence: number;
}

export interface RiskRewardCall {
  /** Coarse band the recommendation lands in. Mirrors
   *  metaCourseIntelligence's RiskAssessment. */
  band: 'conservative' | 'standard' | 'aggressive' | 'go_for_it';
  /** One-line summary of what we're trading off. */
  tradeoff: string;
  /** The "if you're feeling cautious" alternative, when one exists. */
  alternative_play: string | null;
}

export interface EnrichedLieAnalysis {
  /** Base lie result from the vision endpoint. Always present (even on
   *  failure — falls back to a minimal LieAnalysis when the vision call
   *  errored, with confidence_level='low'). */
  base: LieAnalysis;
  /** Optional acoustic prior from the player's last strike. */
  acoustic_prior: AcousticPriorSignal | null;
  /** Risk/reward overlay synthesized from the hole + ghost + miss bias. */
  risk_reward: RiskRewardCall | null;
  /** Sources used in the enrichment — surfaces as chip row. */
  sources_used: ('vision' | 'acoustic' | 'meta_strategy')[];
  /** Composed voice summary the caddie speaks. Persona-aware via the
   *  base analysis's tactical_advice + our risk overlay. */
  voice_summary: string;
}

export interface EnrichLieInput {
  imageBase64: string;
  imageMediaType?: 'image/jpeg' | 'image/png';
  voiceGender?: 'male' | 'female';
  /** Optional pre-built acoustic signal. When omitted, no acoustic
   *  enrichment is attempted (we don't want a stale strike to bias the
   *  CURRENT lie call). */
  acoustic?: AcousticPriorSignal | null;
  /** When true, also runs metaCourseIntelligence.recommendShot to layer
   *  a risk/reward call. Optional — caller decides whether the user
   *  wants strategic depth or just the tactical lie read. */
  include_strategy?: boolean;
}

/**
 * Enrich the existing analyzeLie pipeline with adjacent signals.
 * Defensive: every enrichment branch tolerates failure of its source.
 * Returns a fully-populated EnrichedLieAnalysis even when only the base
 * vision call succeeded.
 */
export async function enrichedLieAnalysis(input: EnrichLieInput): Promise<EnrichedLieAnalysis> {
  // 1. Base vision call — bundled context.
  const ctxMod = await import('./lieAnalysisContext');
  const context = await ctxMod.bundleLieAnalysisContext(null);
  const baseResult = await analyzeLie(
    input.imageBase64,
    context,
    input.imageMediaType ?? 'image/jpeg',
    input.voiceGender ?? 'male',
  );

  let base: LieAnalysis;
  if (baseResult.kind === 'ok') {
    base = baseResult.analysis;
  } else {
    base = {
      situation_description: 'Lie read unavailable — try a fresh capture.',
      tactical_advice: 'Trust your eyes and pick the safer play.',
      recommended_club: null,
      alternative_play: 'Lay up to a comfortable yardage.',
      confidence_level: 'low',
      conservative_call: true,
      follow_up_question: null,
    };
  }

  const sources_used: EnrichedLieAnalysis['sources_used'] = ['vision'];
  if (input.acoustic) sources_used.push('acoustic');

  // 2. Risk/reward synthesis via metaCourseIntelligence.
  let riskReward: RiskRewardCall | null = null;
  if (input.include_strategy) {
    try {
      const meta = await import('./metaCourseIntelligence');
      const rec = await meta.recommendShot({
        lie_hint: base.situation_description,
      });
      sources_used.push('meta_strategy');
      riskReward = {
        band: rec.risk,
        tradeoff:
          rec.risk === 'conservative' ? 'Protect the score — middle of the green.'
          : rec.risk === 'standard' ? 'Standard play — execute the shot.'
          : rec.risk === 'aggressive' ? 'Take the smart aggressive line.'
          : 'Send it — green light.',
        alternative_play: rec.alternative_play,
      };
    } catch (e) {
      console.log('[lie] meta strategy enrichment failed (non-fatal):', e);
    }
  }

  // 3. Compose the spoken summary.
  const voice = composeEnrichedVoice(base, input.acoustic ?? null, riskReward);

  return {
    base,
    acoustic_prior: input.acoustic ?? null,
    risk_reward: riskReward,
    sources_used,
    voice_summary: voice,
  };
}

function composeEnrichedVoice(
  base: LieAnalysis,
  acoustic: AcousticPriorSignal | null,
  rr: RiskRewardCall | null,
): string {
  const parts: string[] = [];
  parts.push(base.tactical_advice);
  if (acoustic && acoustic.confidence >= 60 && acoustic.turf !== 'unknown') {
    parts.push(`Last strike was ${acoustic.turf} — factor that in.`);
  }
  if (rr) parts.push(rr.tradeoff);
  return parts.join(' ').trim();
}
